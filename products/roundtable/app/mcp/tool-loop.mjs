import { createHash } from "node:crypto";

import {
  formatFunctionResult,
  mcpToolResultToText,
  parseToolCall,
  toolCallFingerprint,
} from "./tool-call-parser.mjs";
import { defaultToolRegistry, validateToolMetadata } from "@web-agents/local-core/tool-registry";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "permission_denied",
  "tool_limit_exceeded",
]);

export class ToolLoopError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "ToolLoopError";
    this.code = code;
    this.details = details;
  }
}

function requireString(value, code, label) {
  if (typeof value !== "string" || !value.trim()) throw new ToolLoopError(code, `${label} is required.`);
  return value.trim();
}

function resultStatus(result) {
  return result?.isError ? "error" : "ok";
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || "TOOL_LOOP_FAILED",
    message: error?.message || String(error),
    details: error?.details || null,
  };
}

function publicState(state) {
  return structuredClone({
    executionId: state.executionId,
    taskId: state.taskId,
    executorId: state.executorId,
    status: state.status,
    maxToolCalls: state.maxToolCalls,
    protocolTurns: state.protocolTurns,
    captureCount: state.captures.length,
    captures: state.captures,
    toolCalls: state.toolCalls,
    pendingCall: state.pendingCall,
    permissionRequest: state.permissionRequest,
    transactionId: state.transactionId,
    finalText: state.finalText,
    error: state.error,
    rollbackError: state.rollbackError,
  });
}

function normalizeParsedCall(parsed) {
  if (parsed === null || parsed === undefined) return null;
  if (Array.isArray(parsed)) {
    if (parsed.length > 1) {
      throw new ToolLoopError("MULTIPLE_TOOL_CALLS", "Only one tool call is allowed per captured response.");
    }
    return parsed[0] ? normalizeParsedCall(parsed[0]) : null;
  }
  const name = requireString(parsed.name, "INVALID_TOOL_CALL", "Tool name");
  const callId = requireString(String(parsed.callId ?? parsed.call_id ?? ""), "INVALID_TOOL_CALL", "Tool call ID");
  const args = parsed.arguments ?? parsed.args ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolLoopError("INVALID_TOOL_CALL", "Tool call arguments must be an object.");
  }
  return {
    name,
    callId,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    arguments: args,
    rawText: typeof parsed.rawText === "string" ? parsed.rawText : "",
  };
}

function hashFingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 20);
}

export class ToolLoop {
  constructor({
    captureText,
    capture,
    parse = parseToolCall,
    formatResult = formatFunctionResult,
    resultToText = mcpToolResultToText,
    registry = defaultToolRegistry,
    permissionBroker,
    transactionManager,
    executeTool,
    maxToolCalls = 8,
    onTransition = null,
  } = {}) {
    this.captureText = captureText || capture;
    if (typeof this.captureText !== "function") {
      throw new ToolLoopError("CAPTURE_DEPENDENCY_REQUIRED", "ToolLoop requires an injected captureText function.");
    }
    if (typeof parse !== "function" || typeof formatResult !== "function" || typeof resultToText !== "function") {
      throw new ToolLoopError("INVALID_TOOL_LOOP_DEPENDENCY", "ToolLoop parser and formatters must be functions.");
    }
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1) {
      throw new ToolLoopError("INVALID_TOOL_CALL_LIMIT", "maxToolCalls must be a positive integer.");
    }
    this.parse = parse;
    this.formatResult = formatResult;
    this.resultToText = resultToText;
    this.registry = registry;
    this.permissionBroker = permissionBroker;
    this.transactionManager = transactionManager;
    this.executeTool = executeTool;
    this.maxToolCalls = maxToolCalls;
    this.onTransition = onTransition;
    this.states = new Map();
    this.running = new Map();
  }

  async #transition(state, status) {
    state.status = status;
    if (typeof this.onTransition === "function") await this.onTransition(publicState(state));
  }

  #registryMetadata(tool) {
    const metadata = this.registry && typeof this.registry.get === "function"
      ? this.registry.get(tool)
      : this.registry?.[tool];
    if (!metadata) throw new ToolLoopError("UNKNOWN_TOOL", `Tool ${tool} is not registered.`);
    return validateToolMetadata(metadata, { toolName: tool });
  }

  #registryPaths(tool, args) {
    if (this.registry && typeof this.registry.extractPathSpecs === "function") {
      return this.registry.extractPathSpecs(tool, args);
    }
    return [];
  }

  #createState(input) {
    const executionId = requireString(input.executionId, "EXECUTION_ID_REQUIRED", "Execution ID");
    const taskId = requireString(input.taskId, "TASK_ID_REQUIRED", "Task ID");
    const executorId = requireString(input.executorId, "EXECUTOR_ID_REQUIRED", "Executor ID");
    const initialPrompt = requireString(input.prompt ?? input.input, "PROMPT_REQUIRED", "Initial prompt");
    const limit = input.maxToolCalls ?? this.maxToolCalls;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.maxToolCalls) {
      throw new ToolLoopError(
        "INVALID_TOOL_CALL_LIMIT",
        `Execution maxToolCalls must be between 1 and ${this.maxToolCalls}.`
      );
    }
    return {
      executionId,
      taskId,
      executorId,
      initialPrompt,
      maxToolCalls: limit,
      status: "ready",
      protocolTurns: 0,
      captures: [],
      toolCalls: [],
      callIds: new Map(),
      nextInput: initialPrompt,
      pendingCall: null,
      permissionRequest: null,
      transactionId: null,
      finalText: null,
      error: null,
      rollbackError: null,
      context: input.context || {},
    };
  }

  #assertCompatibleInput(state, input) {
    const fields = [
      ["taskId", input.taskId],
      ["executorId", input.executorId],
      ["initialPrompt", input.prompt ?? input.input],
      ["maxToolCalls", input.maxToolCalls],
    ];
    for (const [field, supplied] of fields) {
      const normalized = field === "maxToolCalls" ? Number(supplied) : String(supplied);
      if (supplied !== undefined && normalized !== state[field]) {
        throw new ToolLoopError(
          "EXECUTION_ID_MISMATCH",
          `Execution ID ${state.executionId} was reused with different ${field}.`,
          { executionId: state.executionId, field }
        );
      }
    }
  }

  async #rollbackIfNeeded(state, reason) {
    if (!state.transactionId || !this.transactionManager) return null;
    try {
      const transaction = this.transactionManager.getTransaction(state.transactionId);
      if (["active", "committed", "failed"].includes(transaction.status)) {
        return await this.transactionManager.rollback(state.transactionId, { reason });
      }
      return transaction.rollback || null;
    } catch (error) {
      state.rollbackError = serializeError(error);
      return null;
    }
  }

  async #fail(state, error, code = "TOOL_LOOP_FAILED") {
    await this.#rollbackIfNeeded(state, "tool_loop_failure");
    const wrapped = error instanceof ToolLoopError
      ? error
      : new ToolLoopError(error?.code || code, error?.message || String(error), error?.details || {}, { cause: error });
    state.error = serializeError(wrapped);
    await this.#transition(state, "failed");
    throw wrapped;
  }

  async #capture(state, signal) {
    const response = await this.captureText({
      executionId: state.executionId,
      taskId: state.taskId,
      executorId: state.executorId,
      input: state.nextInput,
      prompt: state.nextInput,
      iteration: state.captures.length,
      toolCallCount: state.toolCalls.length,
      context: state.context,
      signal,
    });
    const text = typeof response === "string" ? response : response?.text;
    if (typeof text !== "string") {
      throw new ToolLoopError("INVALID_CAPTURE_RESULT", "captureText must return text or an object with text.");
    }
    state.captures.push({ index: state.captures.length, text });
    return text;
  }

  async #authorize(state, permission) {
    if (!this.permissionBroker || typeof this.permissionBroker.authorize !== "function") {
      throw new ToolLoopError("PERMISSION_BROKER_REQUIRED", "ToolLoop requires an injected permission broker.");
    }
    const call = state.pendingCall;
    const paths = this.#registryPaths(call.name, call.arguments);
    const authorization = await this.permissionBroker.authorize({
      taskId: state.taskId,
      executorId: state.executorId,
      tool: call.name,
      args: call.arguments,
      paths,
      permission,
      context: {
        ...state.context,
        capturedText: state.captures.at(-1)?.text || call.rawText || "",
      },
    });
    if (authorization?.allowed) return authorization;
    if (authorization?.status === "permission_required") {
      state.permissionRequest = authorization.request;
      await this.#transition(state, "awaiting_permission");
      return null;
    }
    state.error = {
      name: "PermissionDenied",
      code: authorization?.code || "PERMISSION_DENIED",
      message: authorization?.reason || "Tool permission was denied.",
      details: {
        tool: call.name,
        callId: call.callId,
        qualityFlags: authorization?.qualityFlags || [],
      },
    };
    await this.#rollbackIfNeeded(state, "permission_denied");
    await this.#transition(state, "permission_denied");
    return null;
  }

  async #ensureTransaction(state) {
    if (state.transactionId) return state.transactionId;
    if (!this.transactionManager || typeof this.transactionManager.begin !== "function") {
      throw new ToolLoopError("TRANSACTION_MANAGER_REQUIRED", "Mutating tool calls require a transaction manager.");
    }
    const transaction = await this.transactionManager.begin({
      taskId: state.taskId,
      sessionId: state.context?.request?.sessionId || state.context?.sessionId || null,
      executorId: state.executorId,
      originalInstruction: state.initialPrompt,
      executionId: `${state.executionId}:transaction`,
    });
    state.transactionId = transaction.id;
    return transaction.id;
  }

  async #executePending(state, authorization, signal) {
    const call = state.pendingCall;
    const metadata = this.#registryMetadata(call.name);
    const fingerprint = toolCallFingerprint(call);
    const executionId = `${state.executionId}:${call.callId}:${hashFingerprint(fingerprint)}`;
    let result;
    let status = "ok";
    let executionError = null;
    try {
      if (metadata.mutating) {
        const transactionId = await this.#ensureTransaction(state);
        const executed = await this.transactionManager.execute(transactionId, {
          executionId,
          executorId: state.executorId,
          tool: call.name,
          args: call.arguments,
          paths: this.#registryPaths(call.name, call.arguments),
          signal,
          context: {
            ...state.context,
            permission: authorization,
            loopExecutionId: state.executionId,
          },
        });
        result = executed.result;
      } else {
        if (typeof this.executeTool !== "function") {
          throw new ToolLoopError("TOOL_EXECUTOR_REQUIRED", "Read-only tool calls require an injected executor.");
        }
        result = await this.executeTool(call.name, call.arguments, {
          ...state.context,
          executionId,
          loopExecutionId: state.executionId,
          permission: authorization,
          signal,
        });
      }
      status = resultStatus(result);
    } catch (error) {
      status = "error";
      executionError = serializeError(error);
      result = { isError: true, error: executionError, content: [{ type: "text", text: executionError.message }] };
    }

    const resultText = this.resultToText(result);
    const formattedResult = this.formatResult(call.callId, resultText, status);
    const record = {
      callId: call.callId,
      name: call.name,
      description: call.description,
      arguments: call.arguments,
      fingerprint,
      executionId,
      status,
      authorization: authorization.authorization,
      resultText,
      formattedResult,
      error: executionError,
    };
    state.toolCalls.push(record);
    state.callIds.set(call.callId, record);
    state.pendingCall = null;
    state.permissionRequest = null;
    state.nextInput = formattedResult;
    await this.#transition(state, "running");
  }

  async #complete(state, finalText) {
    if (state.transactionId && this.transactionManager) {
      const transaction = this.transactionManager.getTransaction(state.transactionId);
      if (transaction.status === "active") await this.transactionManager.commit(state.transactionId);
    }
    state.finalText = finalText;
    await this.#transition(state, "completed");
    return publicState(state);
  }

  async #drive(state, { permission = null, signal } = {}) {
    if (TERMINAL_STATUSES.has(state.status)) return publicState(state);
    let resumePermission = permission;
    try {
      await this.#transition(state, "running");
      while (true) {
        if (!state.pendingCall) {
          const text = await this.#capture(state, signal);
          const call = normalizeParsedCall(await this.parse(text));
          if (!call) return this.#complete(state, text);

          state.protocolTurns += 1;
          if (state.protocolTurns > state.maxToolCalls) {
            state.error = {
              name: "ToolCallLimitError",
              code: "TOOL_CALL_LIMIT_EXCEEDED",
              message: `Tool call limit of ${state.maxToolCalls} was exceeded.`,
              details: { maxToolCalls: state.maxToolCalls },
            };
            await this.#rollbackIfNeeded(state, "tool_call_limit_exceeded");
            await this.#transition(state, "tool_limit_exceeded");
            return publicState(state);
          }

          // Registry lookup is deliberately performed before any permission or execution side effect.
          this.#registryMetadata(call.name);
          const fingerprint = toolCallFingerprint(call);
          const prior = state.callIds.get(call.callId);
          if (prior) {
            if (prior.fingerprint !== fingerprint) {
              throw new ToolLoopError(
                "CALL_ID_REUSED",
                `Tool call ID ${call.callId} was reused with different arguments.`,
                { callId: call.callId }
              );
            }
            state.nextInput = prior.formattedResult;
            continue;
          }
          state.pendingCall = call;
        }

        const authorization = await this.#authorize(state, resumePermission);
        resumePermission = null;
        if (!authorization) return publicState(state);
        await this.#executePending(state, authorization, signal);
      }
    } catch (error) {
      return this.#fail(state, error);
    }
  }

  run(input = {}) {
    const executionId = requireString(input.executionId, "EXECUTION_ID_REQUIRED", "Execution ID");
    let state = this.states.get(executionId);
    if (!state) {
      state = this.#createState(input);
      this.states.set(executionId, state);
    } else {
      this.#assertCompatibleInput(state, input);
    }
    if (TERMINAL_STATUSES.has(state.status)) return Promise.resolve(publicState(state));
    if (state.status === "awaiting_permission" && !input.permission) return Promise.resolve(publicState(state));
    if (this.running.has(executionId)) return this.running.get(executionId);

    const promise = this.#drive(state, input).finally(() => {
      if (this.running.get(executionId) === promise) this.running.delete(executionId);
    });
    this.running.set(executionId, promise);
    return promise;
  }

  resume(input = {}) {
    return this.run(input);
  }

  getState(executionId) {
    const state = this.states.get(String(executionId || ""));
    return state ? publicState(state) : null;
  }
}

export function createToolLoop(dependencies) {
  return new ToolLoop(dependencies);
}

export async function runToolLoop(dependencies, input) {
  return new ToolLoop(dependencies).run(input);
}

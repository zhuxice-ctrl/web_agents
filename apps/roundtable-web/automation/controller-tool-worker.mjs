import { AutomationError } from "./errors.mjs";
import { ToolLoop } from "../mcp/tool-loop.mjs";
import { analyzeReplyQuality } from "../orchestrator/quality-analyzer.mjs";

function serializeTransaction(manager, transactionId) {
  if (!transactionId) return null;
  try {
    return manager.getTransaction(transactionId);
  } catch {
    return null;
  }
}

export class ControllerToolWorker {
  constructor({
    browserWorker,
    permissionBroker,
    transactionManager,
    registry,
    store,
    executeTool,
    runRegistry = null,
    maxToolCalls = 8,
  } = {}) {
    if (!browserWorker) throw new Error("BROWSER_WORKER_REQUIRED");
    if (!permissionBroker) throw new Error("PERMISSION_BROKER_REQUIRED");
    if (!transactionManager) throw new Error("TRANSACTION_MANAGER_REQUIRED");
    if (!registry) throw new Error("TOOL_REGISTRY_REQUIRED");
    if (!store) throw new Error("STORE_REQUIRED");
    this.browserWorker = browserWorker;
    this.permissionBroker = permissionBroker;
    this.transactionManager = transactionManager;
    this.registry = registry;
    this.store = store;
    this.executeTool = executeTool;
    this.runRegistry = runRegistry;
    this.pending = new Map();
    this.permissions = new Map();

    const authorityBroker = {
      authorize: async (input) => {
        const metadata = registry.get(input.tool);
        const callerId = input.context?.request?.providerId;
        if (metadata.mutating && callerId && callerId !== input.executorId) {
          return {
            status: "denied",
            allowed: false,
            code: "WRITE_EXECUTOR_REQUIRED",
            reason: `写入执行权属于 ${input.executorId}，${callerId} 只能读取和提出方案。`,
          };
        }
        if (metadata.mutating) {
          const quality = analyzeReplyQuality(input.context?.capturedText || "");
          if (!quality.sideEffectsAllowed) {
            return {
              status: "denied",
              allowed: false,
              code: "LOW_CONFIDENCE_SIDE_EFFECT_BLOCKED",
              reason: "低可信模型输出只能保留为讨论证据，不能直接修改本地文件。",
              qualityFlags: quality.flagCodes,
            };
          }
        }
        return permissionBroker.authorize(input);
      },
    };

    this.toolLoop = new ToolLoop({
      registry,
      permissionBroker: authorityBroker,
      transactionManager,
      executeTool,
      maxToolCalls,
      captureText: async ({ input, context, signal }) => {
        return browserWorker.execute({
          ...context.request,
          prompt: input,
          signal: signal || context.request.signal,
        });
      },
      onTransition: async (loopState) => {
        const request = this.pending.get(loopState.executionId)?.request;
        if (!request) return;
        await this.syncTransaction(request.sessionId, loopState.transactionId);
      },
    });
  }

  executionId(request) {
    return request.executionId || `turn:${request.sessionId}:${request.planId}:${request.turnId}`;
  }

  async syncTransaction(sessionId, transactionId) {
    const transaction = serializeTransaction(this.transactionManager, transactionId);
    if (!transaction || !sessionId) return;
    await this.store.updateSession(sessionId, (session) => {
      const existing = (session.transactions || []).findIndex((candidate) => candidate.id === transaction.id);
      if (existing >= 0) session.transactions[existing] = transaction;
      else session.transactions = [...(session.transactions || []), transaction];
      session.updatedAt = new Date().toISOString();
      return session;
    });
  }

  async execute(request) {
    const executionId = this.executionId(request);
    const designatedExecutor = request.writeExecutorId || request.providerId;
    const prior = this.pending.get(executionId) || { request };
    prior.request = request;
    this.pending.set(executionId, prior);
    const permission = this.permissions.get(executionId) || null;
    if (permission) this.permissions.delete(executionId);

    const result = await this.toolLoop.run({
      executionId,
      taskId: request.planId || request.sessionId,
      executorId: designatedExecutor,
      prompt: request.prompt,
      permission,
      signal: request.signal,
      context: { request },
    });
    await this.syncTransaction(request.sessionId, result.transactionId);

    if (result.status === "awaiting_permission") {
      const permissionRequest = {
        ...result.permissionRequest,
        id: result.permissionRequest.requestId,
        operation: result.pendingCall?.name,
        toolName: result.pendingCall?.name,
        summary: result.pendingCall?.description || "模型请求修改本地文件",
        reversible: this.registry.get(result.pendingCall?.name).reversible,
        executionId,
        sessionId: request.sessionId,
        planId: request.planId,
        turnId: request.turnId,
        runId: request.runId || null,
      };
      this.pending.set(permissionRequest.requestId, { executionId, request, permissionRequest });
      const error = new AutomationError("PERMISSION_REQUIRED", "工作区外写入等待用户确认。", permissionRequest);
      error.permissionRequest = permissionRequest;
      throw error;
    }
    if (["permission_denied", "failed", "tool_limit_exceeded"].includes(result.status)) {
      const details = result.error?.details || {};
      const error = new AutomationError(
        result.error?.code || "TOOL_LOOP_FAILED",
        result.error?.message || "本地工具闭环执行失败。",
        { ...details, diagnostics: details },
      );
      throw error;
    }
    this.pending.delete(executionId);
    const lastCapture = result.captures?.at(-1) || null;
    return {
      providerId: request.providerId,
      text: result.finalText,
      capture: {
        controllerToolLoop: true,
        executionId,
        captureCount: result.captureCount,
        toolCalls: result.toolCalls,
        transactionId: result.transactionId,
        finalCaptureIndex: lastCapture?.index ?? null,
      },
    };
  }

  listPermissionRequests() {
    return [...this.pending.values()]
      .map((entry) => entry.permissionRequest)
      .filter(Boolean)
      .filter((request) => this.permissionBroker.getRequest(request.requestId)?.status === "pending")
      .filter((request) => {
        if (!request.runId || !this.runRegistry) return true;
        const run = this.runRegistry.get(request.runId);
        return run?.status === "waiting_recovery" && run.failedTurnId === request.turnId;
      });
  }

  async resolvePermission(requestId, decision) {
    const entry = this.pending.get(requestId);
    if (!entry) throw new AutomationError("REQUEST_NOT_FOUND", "权限请求不存在或已结束。");
    const resolved = await this.permissionBroker.resolveRequest({ requestId, decision });
    if (resolved.status === "approved") {
      this.permissions.set(entry.executionId, { requestId, token: resolved.token });
      if (entry.request.runId && this.runRegistry?.get(entry.request.runId)) {
        this.runRegistry.retry(entry.request.runId, entry.request.turnId, { reuseExecutionId: true });
      }
    } else if (resolved.status === "rejected" && entry.request.runId && this.runRegistry?.get(entry.request.runId)) {
      this.runRegistry.skip(entry.request.runId, entry.request.turnId);
    }
    this.pending.delete(requestId);
    if (resolved.status === "rejected") this.pending.delete(entry.executionId);
    return { ...resolved, executionId: entry.executionId, request: entry.permissionRequest };
  }

  getTransaction(transactionId) {
    return this.transactionManager.getTransaction(transactionId);
  }

  listTransactions(options) {
    return this.transactionManager.listTransactions(options);
  }

  rollback(transactionId, options) {
    return this.transactionManager.rollback(transactionId, options);
  }
}

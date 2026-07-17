import { AutomationError, throwIfAborted } from "./errors.mjs";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function baselineAssistantText(capture) {
  const messages = Array.isArray(capture?.messages) ? capture.messages : [];
  const assistant = [...messages].reverse().find((message) => message.speaker === "assistant");
  return normalizeText(assistant?.text || messages.at(-1)?.text || "");
}

function autoSendError(providerId, result) {
  const code = result?.state === "verification_required"
    ? "HUMAN_VERIFICATION_REQUIRED"
    : result?.state === "input_busy"
      ? "INPUT_BUSY"
    : result?.state === "no_input"
      ? "COMPOSER_NOT_FOUND"
      : "SUBMIT_FAILED";
  return new AutomationError(code, result?.message || "The extension could not submit the provider prompt.", {
    providerId,
    state: result?.state || "unknown",
  });
}

export class ExtensionBrowserWorker {
  constructor({ manager, now = () => Date.now(), delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    if (!manager) throw new Error("EXTENSION_BROWSER_MANAGER_REQUIRED");
    this.manager = manager;
    this.now = now;
    this.delay = delay;
  }

  async execute(request) {
    const providerId = String(request.providerId || "");
    if (!providerId) throw new AutomationError("UNSUPPORTED_PROVIDER", "Extension worker requires a provider id.");
    if (!normalizeText(request.prompt)) throw new AutomationError("EMPTY_PROMPT", "Extension worker received an empty prompt.");
    throwIfAborted(request.signal);
    const binding = this.manager.getBinding(providerId);

    const auth = await this.manager.sendToBoundTab(providerId, { type: "tab:auth-probe" }, {
      timeoutMs: Math.min(20000, request.timeoutMs || 20000),
    });
    if (auth?.verificationRequired) {
      this.manager.forgetPage(providerId);
      throw new AutomationError("HUMAN_VERIFICATION_REQUIRED", `${providerId} requires manual human verification.`, {
        providerId,
      });
    }
    if (auth?.provider !== providerId) {
      this.manager.forgetPage(providerId);
      throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
        providerId,
        detectedProviderId: auth?.provider || null,
      });
    }
    if (!auth.authenticated) {
      this.manager.forgetPage(providerId);
      throw new AutomationError("LOGIN_REQUIRED", `${providerId} is no longer signed in.`, {
        providerId,
        reason: auth?.reason || "login_required",
      });
    }

    const baselineCapture = await this.manager.sendToBoundTab(providerId, {
      type: "tab:capture-recent",
      limit: 20,
    }, { timeoutMs: 15000 });
    if (baselineCapture?.provider !== providerId) {
      this.manager.forgetPage(providerId);
      throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
        providerId,
        detectedProviderId: baselineCapture?.provider || null,
      });
    }
    const baselineText = baselineAssistantText(baselineCapture);
    let submission;

    if (!request.autoSend) {
      const inserted = await this.manager.sendToBoundTab(providerId, {
        type: "tab:insert-text",
        text: request.prompt,
      }, { timeoutMs: 15000 });
      if (inserted?.provider !== providerId) {
        this.manager.forgetPage(providerId);
        throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
          providerId,
          detectedProviderId: inserted?.provider || null,
        });
      }
      if (!inserted?.ok) {
        const code = inserted?.state === "input_busy"
          ? "INPUT_BUSY"
          : inserted?.state === "no_input"
            ? "COMPOSER_NOT_FOUND"
            : "PROMPT_INSERT_FAILED";
        throw new AutomationError(code, inserted?.message || "The extension could not insert the prompt.", {
          providerId,
          state: inserted?.state || "unknown",
        });
      }
      throw new AutomationError("MANUAL_SEND_REQUIRED", `${providerId} prompt is inserted and waiting for manual send.`, {
        providerId,
      });
    }

    await request.checkpoint?.("submitting", { providerId, threadKey: request.threadKey || null });
    const sent = await this.manager.sendToBoundTab(providerId, {
      type: "tab:auto-send-text",
      text: request.prompt,
    }, { timeoutMs: 20000 });
    if (sent?.provider !== providerId) {
      this.manager.forgetPage(providerId);
      throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
        providerId,
        detectedProviderId: sent?.provider || null,
      });
    }
    if (sent?.state !== "sent") throw autoSendError(providerId, sent);
    await request.checkpoint?.("submitted", { providerId, threadKey: request.threadKey || null, url: binding.url });
    submission = { method: "extension", state: sent.state, message: sent.message };

    if (!request.autoCapture) {
      throw new AutomationError("MANUAL_CAPTURE_REQUIRED", `${providerId} prompt was sent and is waiting for manual capture.`, {
        providerId,
      });
    }

    const timeoutMs = Math.max(1000, Number(request.timeoutMs) || 180000);
    const promptText = normalizeText(request.prompt);
    const settleMs = Math.max(250, Number(request.settleMs) || 3000);
    const pollIntervalMs = Math.min(750, Math.max(200, Math.floor(settleMs / 3)));
    const deadline = this.now() + timeoutMs;
    let latestText = "";
    let latestSnapshot = null;
    let firstChangedAt = null;
    let lastChangedAt = null;

    while (this.now() < deadline) {
      throwIfAborted(request.signal);
      try {
        const status = await this.manager.sendToBoundTab(providerId, { type: "tab:detect" }, {
          timeoutMs: Math.min(10000, Math.max(1000, deadline - this.now())),
        });
        if (status?.verificationRequired) {
          this.manager.forgetPage(providerId);
          throw new AutomationError("HUMAN_VERIFICATION_REQUIRED", `${providerId} requires manual human verification.`, {
            providerId,
          });
        }
        if (status?.provider !== providerId) {
          this.manager.forgetPage(providerId);
          throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
            providerId,
            detectedProviderId: status?.provider || null,
          });
        }
        const snapshot = await this.manager.sendToBoundTab(providerId, { type: "tab:capture-latest" }, {
          timeoutMs: Math.min(15000, Math.max(1000, deadline - this.now())),
        });
        if (snapshot?.provider !== providerId) {
          this.manager.forgetPage(providerId);
          throw new AutomationError("PROVIDER_URL_MISMATCH", `${providerId} binding moved to another provider.`, {
            providerId,
            detectedProviderId: snapshot?.provider || null,
          });
        }
        const text = normalizeText(snapshot?.text);
        const isAssistantResponse = snapshot?.speaker === "assistant";
        const isUnverifiedPromptEcho = text === promptText && !isAssistantResponse;
        if (isAssistantResponse && !isUnverifiedPromptEcho && text && text !== baselineText) {
          if (text !== latestText) {
            latestText = text;
            latestSnapshot = snapshot;
            firstChangedAt ??= this.now();
            lastChangedAt = this.now();
          } else if (
            firstChangedAt !== null
            && lastChangedAt !== null
            && this.now() - firstChangedAt >= Math.min(1000, settleMs)
            && this.now() - lastChangedAt >= settleMs
          ) {
            await request.checkpoint?.("captured", {
              providerId,
              threadKey: request.threadKey || null,
              capturedAt: latestSnapshot?.capturedAt || new Date().toISOString(),
            });
            return {
              providerId,
              text: latestText,
              capture: {
                tabId: binding.tabId,
                url: binding.url,
                source: latestSnapshot?.source || null,
                capturedAt: latestSnapshot?.capturedAt || new Date().toISOString(),
                submission,
                baselineChanged: true,
              },
            };
          }
        }
      } catch (error) {
        if (!["EXTENSION_TAB_COMMAND_FAILED", "EXTENSION_COMMAND_TIMEOUT"].includes(error?.code)) throw error;
      }
      await this.delay(pollIntervalMs);
    }

    throw new AutomationError("PROVIDER_RESPONSE_TIMEOUT", `${providerId} did not produce a stable new response before timeout.`, {
      providerId,
      timeoutMs,
      observedNewResponse: Boolean(latestText),
    });
  }
}

export { baselineAssistantText, normalizeText };

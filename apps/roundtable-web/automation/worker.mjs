import fs from "node:fs/promises";
import path from "node:path";

import { waitForCompletedResponse } from "./completion-detector.mjs";
import { AutomationError, throwIfAborted } from "./errors.mjs";
import { ProviderConcurrency } from "./provider-concurrency.mjs";

function safeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100);
}

async function writeDiagnostics({ page, adapter, request, error }) {
  if (!request.diagnosticsDir) return null;
  await fs.mkdir(request.diagnosticsDir, { recursive: true });
  const prefix = `${new Date().toISOString().replace(/[:.]/g, "")}-${safeName(request.providerId)}-${safeName(request.turnId)}`;
  const screenshotPath = path.join(request.diagnosticsDir, `${prefix}.png`);
  const htmlPath = path.join(request.diagnosticsDir, `${prefix}.html`);
  const metadataPath = path.join(request.diagnosticsDir, `${prefix}.json`);
  const files = { metadataPath };
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    files.screenshotPath = screenshotPath;
  } catch {
    // A closed page cannot provide a screenshot.
  }
  const html = await page.content().catch(() => "");
  if (html) {
    await fs.writeFile(htmlPath, html.slice(0, 500000), "utf8").catch(() => {});
    files.htmlPath = htmlPath;
  }
  const metadata = {
    at: new Date().toISOString(),
    sessionId: request.sessionId,
    planId: request.planId,
    turnId: request.turnId,
    providerId: request.providerId,
    url: page.url(),
    title: await page.title().catch(() => ""),
    error: {
      code: error?.code || "PROVIDER_EXECUTION_FAILED",
      message: error?.message || String(error),
      stack: error?.stack || null,
      details: error?.details || null,
    },
    adapter: adapter.describe(),
    files,
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return files;
}

export class BrowserWorker {
  constructor({ manager, adapters, concurrency = null } = {}) {
    if (!manager) throw new Error("BROWSER_MANAGER_REQUIRED");
    this.manager = manager;
    this.adapters = adapters || manager.adapters;
    this.concurrency = concurrency || new ProviderConcurrency();
  }

  async execute(request) {
    return this.concurrency.run(
      request.providerId,
      request.threadKey || request.providerId,
      () => this.executeOnce(request),
      { signal: request.signal }
    );
  }

  async executeOnce(request) {
    const adapter = this.adapters.get(request.providerId);
    if (!adapter) {
      throw new AutomationError("UNSUPPORTED_PROVIDER", `No MVP browser adapter exists for ${request.providerId}.`, {
        providerId: request.providerId,
      });
    }
    if (!String(request.prompt || "").trim()) throw new AutomationError("EMPTY_PROMPT", "Browser worker received an empty prompt.");
    throwIfAborted(request.signal);
    let page = await this.manager.getPage(request.providerId, { threadKey: request.threadKey || null });
    try {
      await request.checkpoint?.("prepared", { providerId: request.providerId, threadKey: request.threadKey || null });
      const composerTimeout = Math.min(30000, Math.max(1000, Math.floor((request.timeoutMs || 180000) / 3)));
      let baseline;
      let composer;
      let lastPreSubmitError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        throwIfAborted(request.signal);
        if (page.isClosed()) {
          this.manager.forgetPage(request.providerId, page, { threadKey: request.threadKey || null });
          page = await this.manager.getPage(request.providerId, { threadKey: request.threadKey || null });
        }
        try {
          baseline = await adapter.collectResponseCandidates(page);
          composer = await adapter.findComposer(page, { timeoutMs: composerTimeout, signal: request.signal });
          await adapter.insertPrompt(page, composer, request.prompt);
          lastPreSubmitError = null;
          break;
        } catch (error) {
          lastPreSubmitError = error;
          const retryable = error?.code === "COMPOSER_STALE" || page.isClosed() || /page, context or browser has been closed/i.test(error.message);
          if (!retryable || attempt === 1) throw error;
          if (page.isClosed()) {
            this.manager.forgetPage(request.providerId, page, { threadKey: request.threadKey || null });
            page = await this.manager.getPage(request.providerId, { threadKey: request.threadKey || null });
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (lastPreSubmitError || !composer) throw lastPreSubmitError || new AutomationError("COMPOSER_NOT_FOUND", "Composer retry failed.");
      await adapter.assertAutomationReady(page, { phase: "before_submit" });
      if (!request.autoSend) {
        throw new AutomationError("MANUAL_SEND_REQUIRED", `${adapter.label} prompt is inserted and waiting for manual send.`, {
          providerId: adapter.id,
        });
      }
      await request.checkpoint?.("submitting", { providerId: request.providerId, threadKey: request.threadKey || null });
      const submission = await adapter.submit(page, composer, {
        timeoutMs: Math.min(12000, composerTimeout),
        signal: request.signal,
      });
      await request.checkpoint?.("submitted", { providerId: request.providerId, threadKey: request.threadKey || null, url: page.url() });
      if (!request.autoCapture) {
        throw new AutomationError("MANUAL_CAPTURE_REQUIRED", `${adapter.label} prompt was sent and is waiting for manual capture.`, {
          providerId: adapter.id,
        });
      }
      const capture = await waitForCompletedResponse({
        page,
        adapter,
        baselineCandidates: baseline,
        timeoutMs: request.timeoutMs || 180000,
        settleMs: request.settleMs || 3000,
        signal: request.signal,
      });
      await request.checkpoint?.("captured", { providerId: request.providerId, threadKey: request.threadKey || null, settledAt: capture.settledAt });
      return {
        providerId: request.providerId,
        text: capture.text,
        capture: {
          selector: capture.selector,
          index: capture.index,
          observedBusy: capture.observedBusy,
          settledAt: capture.settledAt,
          url: page.url(),
          submission,
        },
      };
    } catch (error) {
      let classifiedError = error;
      if (!request.signal?.aborted && !["LOGIN_REQUIRED", "HUMAN_VERIFICATION_REQUIRED"].includes(error?.code)) {
        try {
          await adapter.assertAutomationReady(page, { phase: "error_reclassification" });
        } catch (blockingError) {
          if (["LOGIN_REQUIRED", "HUMAN_VERIFICATION_REQUIRED"].includes(blockingError?.code)) {
            classifiedError = blockingError;
          }
        }
      }
      const diagnostics = await writeDiagnostics({ page, adapter, request, error: classifiedError });
      if (["LOGIN_REQUIRED", "HUMAN_VERIFICATION_REQUIRED"].includes(classifiedError?.code)) {
        this.manager.forgetPage(request.providerId, page, { threadKey: request.threadKey || null });
      }
      this.concurrency.reportSignal(request.providerId, classifiedError?.code);
      if (classifiedError instanceof AutomationError) {
        classifiedError.diagnostics = diagnostics;
        classifiedError.details = { ...(classifiedError.details || {}), diagnostics };
        throw classifiedError;
      }
      throw new AutomationError("PROVIDER_EXECUTION_FAILED", `${adapter.label} automation failed: ${classifiedError.message}`, {
        providerId: request.providerId,
        cause: classifiedError.message,
        diagnostics,
      });
    }
  }
}

export { writeDiagnostics };

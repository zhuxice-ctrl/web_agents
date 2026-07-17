export class AutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.details = details;
    this.diagnostics = details.diagnostics || null;
  }
}
export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new AutomationError("RUN_CANCELLED", reason ? String(reason) : "Roundtable run was cancelled.");
}

export async function abortableDelay(milliseconds, signal) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason instanceof Error
        ? signal.reason
        : new AutomationError("RUN_CANCELLED", "Roundtable run was cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

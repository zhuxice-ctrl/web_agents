import type { ProviderAutomationResult, ProviderAutomationTask } from "../shared/types";

type AutomationClientOptions = {
  baseUrl: string;
  executeTask(task: ProviderAutomationTask): Promise<ProviderAutomationResult>;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
};

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}${pathname}`;
}

export function createAutomationClient({
  baseUrl,
  executeTask,
  fetchImpl = fetch,
  requestTimeoutMs = 20_000
}: AutomationClientOptions) {
  async function requestJson<T>(pathname: string, init: RequestInit = {}, timeoutMs = requestTimeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(joinUrl(baseUrl, pathname), {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`AUTOMATION_GATEWAY_HTTP_${response.status}`);
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function take(waitMs: number): Promise<ProviderAutomationTask | null> {
    const response = await requestJson<{ ok: true; task: ProviderAutomationTask | null }>(
        `/automation/next?waitMs=${encodeURIComponent(String(waitMs))}`,
        {},
        Math.max(requestTimeoutMs, waitMs + 1_000)
    );
    return response.task;
  }

  async function executeAndReport(task: ProviderAutomationTask): Promise<void> {
    let result: ProviderAutomationResult;
    try {
      result = await executeTask(task);
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: (error as { code?: string })?.code || "AUTOMATION_TASK_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
    await requestJson(`/automation/tasks/${encodeURIComponent(task.taskId)}/result`, {
      method: "POST",
      body: JSON.stringify(result)
    });
  }

  return {
    async pollOnce({ waitMs = 15_000 } = {}): Promise<boolean> {
      const task = await take(waitMs);
      if (!task) return false;
      await executeAndReport(task);
      return true;
    },
    async dispatchOnce({ waitMs = 15_000 } = {}): Promise<boolean> {
      const task = await take(waitMs);
      if (!task) return false;
      void executeAndReport(task).catch(() => undefined);
      return true;
    }
  };
}

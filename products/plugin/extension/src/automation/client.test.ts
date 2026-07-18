import { describe, expect, it, vi } from "vitest";

import { createAutomationClient } from "./client";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const task = {
  version: 1 as const,
  type: "provider.generate_image" as const,
  taskId: "task-1",
  clientRequestId: "request-1",
  sessionId: "session-1",
  provider: "grok" as const,
  workspaceRoot: "F:/project",
  payload: {
    prompt: "Generate an image",
    targetDirectory: "F:/project/assets",
    fileName: "image.png"
  }
};

describe("automation client", () => {
  it("returns idle when the gateway has no task", async () => {
    const executeTask = vi.fn();
    const client = createAutomationClient({
      baseUrl: "http://127.0.0.1:3017",
      executeTask,
      fetchImpl: vi.fn(async () => jsonResponse({ ok: true, task: null }))
    });

    await expect(client.pollOnce({ waitMs: 0 })).resolves.toBe(false);
    expect(executeTask).not.toHaveBeenCalled();
  });

  it("executes a received task and posts its result", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/automation/next")) return jsonResponse({ ok: true, task });
      return jsonResponse({ ok: true });
    });
    const executeTask = vi.fn(async () => ({ ok: true as const, filePath: "F:/project/assets/image.png" }));
    const client = createAutomationClient({ baseUrl: "http://127.0.0.1:3017", executeTask, fetchImpl });

    await expect(client.pollOnce({ waitMs: 10 })).resolves.toBe(true);

    expect(executeTask).toHaveBeenCalledWith(task);
    expect(requests[1].url).toContain("/automation/tasks/task-1/result");
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      ok: true,
      filePath: "F:/project/assets/image.png"
    });
  });

  it("aborts a gateway request after the configured timeout", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = createAutomationClient({
      baseUrl: "http://127.0.0.1:3017",
      executeTask: vi.fn(),
      fetchImpl,
      requestTimeoutMs: 10
    });

    await expect(client.pollOnce({ waitMs: 0 })).rejects.toMatchObject({ name: "AbortError" });
  });
});

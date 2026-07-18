import { describe, expect, it, vi } from "vitest";

import { createJsonRpcResponseRouter, createMcpSessionPool } from "./client";

describe("MCP response multiplexing", () => {
  it("routes out-of-order JSON-RPC responses to the matching request", async () => {
    const router = createJsonRpcResponseRouter({ timeoutMs: 1_000 });
    const first = router.wait<string>(1, "first");
    const second = router.wait<string>(2, "second");

    router.handle({ jsonrpc: "2.0", id: 2, result: "two" });
    router.handle({ jsonrpc: "2.0", id: 1, result: "one" });

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
    expect(router.pendingCount).toBe(0);
  });

  it("reuses one initialized session for the same connection key", async () => {
    const session = { request: vi.fn(), post: vi.fn(), close: vi.fn() };
    const openSession = vi.fn(async () => session);
    const initialize = vi.fn(async () => undefined);
    const pool = createMcpSessionPool({ openSession, initialize });

    const [first, second] = await Promise.all([
      pool.get("http://127.0.0.1:3006/sse\0session-a"),
      pool.get("http://127.0.0.1:3006/sse\0session-a")
    ]);

    expect(first).toBe(session);
    expect(second).toBe(session);
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

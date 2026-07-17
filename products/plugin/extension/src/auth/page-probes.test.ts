import { afterEach, describe, expect, it, vi } from "vitest";

import { runProviderAuthProbe } from "./page-probes";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("provider authentication probes", () => {
  it("reduces a ChatGPT session response to a boolean without returning identity or token fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      user: { id: "user-secret", email: "private@example.com" },
      accessToken: "access-token-secret",
      expires: "2099-01-01T00:00:00.000Z"
    })));

    const result = await runProviderAuthProbe("chatgpt");

    expect(result).toEqual({ provider: "chatgpt", authenticated: true, reason: "authenticated" });
    expect(JSON.stringify(result)).not.toMatch(/secret|accessToken|email|user-secret/);
  });

  it("uses the DeepSeek page-owned bearer but never returns it", async () => {
    localStorage.setItem("userToken", JSON.stringify({ value: "deepseek-bearer-secret" }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer deepseek-bearer-secret");
      return jsonResponse({ code: 0, data: { id: "private-user-id" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProviderAuthProbe("deepseek");

    expect(result).toEqual({ provider: "deepseek", authenticated: true, reason: "authenticated" });
    expect(JSON.stringify(result)).not.toMatch(/bearer|private-user-id|secret/i);
  });

  it("reports a missing DeepSeek token without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runProviderAuthProbe("deepseek")).resolves.toEqual({
      provider: "deepseek",
      authenticated: false,
      reason: "token_missing"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the Doubao account endpoint when it exposes a user id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { user_id_str: "doubao-private-id" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProviderAuthProbe("doubao");

    expect(result).toEqual({ provider: "doubao", authenticated: true, reason: "authenticated" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("doubao-private-id");
  });

  it("falls back to the Doubao profile POST without returning profile data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: { profile_brief: { id: "profile-private-id", nickname: "private-name" } }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProviderAuthProbe("doubao");

    expect(result).toEqual({ provider: "doubao", authenticated: true, reason: "authenticated" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/alice/profile/self", expect.objectContaining({ method: "POST" }));
    expect(JSON.stringify(result)).not.toMatch(/profile-private-id|private-name/);
  });

  it("returns a stable failure reason when a provider request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network failure"); }));

    await expect(runProviderAuthProbe("chatgpt")).resolves.toEqual({
      provider: "chatgpt",
      authenticated: false,
      reason: "probe_failed"
    });
  });
});

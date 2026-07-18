import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../shared/defaults";
import { checkGatewayConnection } from "./gateway";

describe("local gateway connection", () => {
  it("reports the configured 3017 gateway as connected", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const result = await checkGatewayConnection(DEFAULT_CONFIG, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3017/health",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) })
    );
    expect(result).toEqual({ state: "connected", url: "http://127.0.0.1:3017" });
  });
});

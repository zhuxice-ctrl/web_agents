import type { ProviderAuthProbeResult, ProviderId } from "../shared/types";

export async function runProviderAuthProbe(provider: ProviderId): Promise<ProviderAuthProbeResult> {
  const result = (
    authenticated: boolean,
    reason: ProviderAuthProbeResult["reason"]
  ): ProviderAuthProbeResult => ({ provider, authenticated, reason });

  try {
    if (provider === "chatgpt") {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return result(false, response.status === 401 || response.status === 403 ? "login_required" : "probe_failed");
      const payload = await response.json().catch(() => null) as { user?: unknown } | null;
      return result(Boolean(payload?.user), payload?.user ? "authenticated" : "login_required");
    }

    if (provider === "deepseek") {
      const raw = localStorage.getItem("userToken");
      let token = "";
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === "object" && "value" in parsed) {
            token = typeof parsed.value === "string" ? parsed.value : "";
          } else if (typeof parsed === "string") {
            token = parsed;
          }
        } catch {
          token = raw;
        }
      }
      if (!token) return result(false, "token_missing");

      const response = await fetch("/api/v0/users/current", {
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) return result(false, response.status === 401 || response.status === 403 ? "login_required" : "probe_failed");
      const payload = await response.json().catch(() => null) as { code?: number; data?: unknown } | null;
      const authenticated = payload?.code === 0 && Boolean(payload.data);
      return result(authenticated, authenticated ? "authenticated" : "login_required");
    }

    if (provider === "doubao") {
      const accountResponse = await fetch("/passport/account/info/v2/", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (accountResponse.ok) {
        const account = await accountResponse.json().catch(() => null) as {
          data?: { user_id_str?: unknown };
        } | null;
        if (account?.data?.user_id_str) return result(true, "authenticated");
      }

      const profileResponse = await fetch("/alice/profile/self", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          "agw-js-conv": "str"
        },
        body: JSON.stringify({ visit_id: "", avatar_format: "png" })
      });
      if (!profileResponse.ok) {
        const unauthorized = [accountResponse.status, profileResponse.status].some((status) => status === 401 || status === 403);
        return result(false, unauthorized ? "login_required" : "probe_failed");
      }
      const profile = await profileResponse.json().catch(() => null) as {
        code?: number;
        data?: { profile_brief?: { id?: unknown } };
      } | null;
      const authenticated = profile?.code === 0 && Boolean(profile.data?.profile_brief?.id);
      return result(authenticated, authenticated ? "authenticated" : "login_required");
    }

    if (provider === "grok") {
      const composer = document.querySelector(
        "textarea[aria-label*='Ask Grok'], textarea[placeholder*='Ask'], [data-testid='composer-input'], [contenteditable='true'][role='textbox']"
      );
      return result(Boolean(composer), composer ? "authenticated" : "login_required");
    }

    return result(false, "unsupported_provider");
  } catch {
    return result(false, "probe_failed");
  }
}

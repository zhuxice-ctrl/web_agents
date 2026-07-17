import { detectProviderByHostname, getProviderById } from "../providers/catalog";
import type { AdapterStatus, ProviderId, ProviderTabStatus } from "../shared/types";

export function sanitizeProviderTabUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function sanitizeDetectedProviderStatus(
  status: AdapterStatus,
  tabId: number,
  tabUrl?: string
): AdapterStatus {
  const sanitizedUrl = sanitizeProviderTabUrl(tabUrl || status.url || "");
  const sanitized = { ...status, tabId };
  delete sanitized.url;
  if (sanitizedUrl) sanitized.url = sanitizedUrl;
  return sanitized;
}

export function providerIdForTabUrl(value: string): ProviderId | null {
  try {
    return detectProviderByHostname(new URL(value).hostname)?.id ?? null;
  } catch {
    return null;
  }
}

export function tabUrlMatchesProvider(value: string, providerId: ProviderId): boolean {
  const provider = getProviderById(providerId);
  if (!provider) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return provider.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function chooseBestProviderTab(tabs: ProviderTabStatus[]): ProviderTabStatus | undefined {
  return [...tabs].sort((left, right) => {
    const score = (tab: ProviderTabStatus) => Number(tab.ready) * 4 + Number(tab.authenticated) * 2 + Number(tab.canInsert);
    return score(right) - score(left) || right.tabId - left.tabId;
  })[0];
}

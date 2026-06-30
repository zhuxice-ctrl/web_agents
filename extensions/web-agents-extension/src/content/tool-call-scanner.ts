import { mergeResponseSelectors } from "../providers/catalog";
import type { ProviderCatalogEntry } from "../providers/catalog";
import type { WebAgentToolCall } from "../shared/types";
import { parseToolCalls, toolCallFingerprint } from "../mcp/tool-call-protocol";

export type CollectedToolCall = {
  call: WebAgentToolCall;
  fingerprint: string;
  element: HTMLElement;
};

function responseElements(documentRef: Document, provider?: ProviderCatalogEntry): HTMLElement[] {
  const selector = mergeResponseSelectors(provider).join(",");
  return Array.from(documentRef.querySelectorAll<HTMLElement>(selector));
}

export function collectToolCallsFromDocument(
  documentRef: Document,
  provider: ProviderCatalogEntry | undefined,
  executedFingerprints: ReadonlySet<string>
): CollectedToolCall[] {
  const collected: CollectedToolCall[] = [];
  const seenInScan = new Set<string>();

  for (const [elementIndex, element] of responseElements(documentRef, provider).entries()) {
    const text = element.innerText || element.textContent || "";
    if (!text.includes("function_call")) continue;

    for (const call of parseToolCalls(text)) {
      const fingerprint = toolCallFingerprint(call);
      const scanKey = `${elementIndex}:${fingerprint}`;
      if (executedFingerprints.has(fingerprint) || seenInScan.has(scanKey)) continue;
      seenInScan.add(scanKey);
      collected.push({ call, fingerprint, element });
    }
  }

  return collected;
}

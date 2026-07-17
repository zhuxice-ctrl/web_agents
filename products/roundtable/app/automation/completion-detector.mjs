import { AutomationError, abortableDelay, throwIfAborted } from "./errors.mjs";

export function normalizeResponseText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectNewResponseCandidate(candidates, baselineCandidates = []) {
  const candidateKey = (candidate, text) => candidate.identity
    ? `${candidate.identity}\u0000${text}`
    : `${candidate.selector || ""}\u0000${candidate.index ?? ""}\u0000${text}`;
  const baseline = new Set(baselineCandidates.map((candidate) => {
    const text = normalizeResponseText(candidate.text);
    return text ? candidateKey(candidate, text) : null;
  }).filter(Boolean));
  const normalized = candidates
    .map((candidate) => ({ ...candidate, text: normalizeResponseText(candidate.text) }))
    .filter((candidate) => candidate.text.length >= 2);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (!baseline.has(candidateKey(normalized[index], normalized[index].text))) return normalized[index];
  }
  return null;
}

export async function waitForCompletedResponse({
  page,
  adapter,
  baselineCandidates = [],
  timeoutMs = 180000,
  settleMs = 3000,
  pollMs = 350,
  signal,
}) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  let latestText = "";
  let changedAt = 0;
  let observedBusy = false;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await adapter.assertAutomationReady?.(page, { phase: "wait_for_response" });
    const [candidates, busy] = await Promise.all([
      adapter.collectResponseCandidates(page),
      adapter.isBusy(page),
    ]);
    observedBusy ||= busy;
    const candidate = selectNewResponseCandidate(candidates, baselineCandidates);
    if (candidate && candidate.text !== latestText) {
      latest = candidate;
      latestText = candidate.text;
      changedAt = Date.now();
    }
    if (latest && !busy && Date.now() - changedAt >= settleMs) {
      return {
        ...latest,
        observedBusy,
        settledAt: new Date().toISOString(),
      };
    }
    await abortableDelay(pollMs, signal);
  }

  throw new AutomationError(
    "RESPONSE_TIMEOUT",
    `Timed out waiting for ${adapter.label} response after ${timeoutMs}ms.`,
    { providerId: adapter.id, latestText, observedBusy }
  );
}

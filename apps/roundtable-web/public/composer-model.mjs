const ALL_ALIASES = new Set(["all", "全体", "大家", "全部"]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildAliasIndex(providers, customAliases = {}) {
  const index = new Map();
  for (const provider of providers || []) {
    for (const alias of [provider.id, provider.label, ...(provider.aliases || []), ...(customAliases[provider.id] || [])]) {
      if (normalize(alias)) index.set(normalize(alias), provider.id);
    }
  }
  index.set("gpt", "chatgpt");
  index.set("ds", "deepseek");
  index.set("豆包", "doubao");
  return index;
}

function candidateRange(text, cursor) {
  const before = String(text || "").slice(0, cursor);
  const match = before.match(/(?:^|[\s，,。；;！？!?])(@?[\p{L}\p{N}_-]*)$/u);
  if (!match) return null;
  const raw = match[1] || "";
  if (!raw) return null;
  return { start: cursor - raw.length, end: cursor, raw, query: normalize(raw.replace(/^@/, "")), explicit: raw.startsWith("@") };
}

export function getComposerSuggestions({ text, cursor, participants, providers, customAliases = {} }) {
  const range = candidateRange(text, cursor);
  if (!range) return { range: null, suggestions: [] };
  const aliasIndex = buildAliasIndex(providers, customAliases);
  const seated = new Set((participants || []).map((participant) => participant.id));
  const suggestions = [];
  if (range.explicit && (!range.query || [...ALL_ALIASES].some((alias) => alias.startsWith(range.query)))) {
    suggestions.push({ id: "all", label: "全体", kind: "all" });
  }
  const seen = new Set();
  for (const provider of providers || []) {
    if (!seated.has(provider.id)) continue;
    const aliases = [provider.id, provider.label, ...(provider.aliases || []), ...[...aliasIndex.entries()].filter(([, id]) => id === provider.id).map(([alias]) => alias)];
    if (!range.query || aliases.some((alias) => normalize(alias).startsWith(range.query))) {
      if (!seen.has(provider.id)) suggestions.push({ id: provider.id, label: provider.label, kind: "provider" });
      seen.add(provider.id);
    }
  }
  return { range, suggestions: suggestions.slice(0, 8) };
}

export function acceptSuggestion({ text, range, suggestion, tokens }) {
  if (!range || !suggestion) return { text, tokens };
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const nextText = `${before}${before && !/\s$/.test(before) ? " " : ""}${after.replace(/^\s+/, "")}`;
  let nextTokens = [...(tokens || [])];
  if (suggestion.kind === "all") {
    nextTokens = [{ id: "all", label: "全体", kind: "all" }];
  } else {
    nextTokens = nextTokens.filter((token) => token.id !== "all" && token.id !== suggestion.id);
    nextTokens.push({ id: suggestion.id, label: suggestion.label, kind: "provider" });
  }
  return { text: nextText, tokens: nextTokens };
}

export function removeToken(tokens, id) {
  return (tokens || []).filter((token) => token.id !== id);
}

export function resolveTargets(tokens, participants) {
  const seated = (participants || []).map((participant) => participant.id);
  if ((tokens || []).some((token) => token.id === "all")) return seated;
  const allowed = new Set(seated);
  return [...new Set((tokens || []).map((token) => token.id).filter((id) => allowed.has(id)))];
}

export function detectReferences(text, providers, selectedTargets = []) {
  const selected = new Set(selectedTargets);
  const aliases = buildAliasIndex(providers);
  const references = new Set();
  const source = normalize(text);
  for (const [alias, providerId] of [...aliases.entries()].sort((left, right) => right[0].length - left[0].length)) {
    if (selected.has(providerId) || alias.length < 2) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "iu").test(source)) references.add(providerId);
  }
  return [...references];
}

export function buildSendPreview({ tokens, participants, providers, text, conversationMode, rounds }) {
  const targets = resolveTargets(tokens, participants);
  const references = detectReferences(text, providers, targets);
  const labels = new Map((providers || []).map((provider) => [provider.id, provider.label]));
  const roundCount = targets.length === 1 ? 1 : Math.max(1, Number(rounds) || 1);
  const mode = conversationMode === "relay"
    ? "顺序传递"
    : targets.length === 1 ? "单独回复" : roundCount === 1 ? "并行观点" : "圆桌讨论";
  return {
    targets,
    targetLabels: targets.map((id) => labels.get(id) || id),
    references,
    referenceLabels: references.map((id) => labels.get(id) || id),
    mode,
    rounds: conversationMode === "relay" ? 1 : roundCount,
    valid: Boolean(String(text || "").trim() && targets.length),
  };
}

import {
  ALL_ALIASES,
  DEFAULT_SETTINGS,
  PROVIDERS,
  PROVIDER_ALIASES,
  getProviderAliases,
  normalizeProviderAlias,
  resolveProviderAlias,
  uniqueProviderIds,
} from "../core/providers.mjs";

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeMention(value) {
  return normalizeProviderAlias(String(value || "").replace(/^@/, ""));
}

export function resolveMention(value) {
  return resolveProviderAlias(normalizeMention(value));
}

function extractLegacyMentionMatches(text) {
  const mentions = [];
  const pattern = /@([\p{L}\p{N}_-]+)/gu;
  for (const match of String(text || "").matchAll(pattern)) {
    mentions.push({
      raw: match[1],
      resolved: resolveMention(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return mentions;
}

export function extractMentions(text) {
  return extractLegacyMentionMatches(text).map(({ raw, resolved }) => ({ raw, resolved }));
}

function parseChineseRound(value) {
  return new Map([
    ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4],
    ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10],
  ]).get(String(value || "").trim());
}

export function parseExplicitRounds(text) {
  const numeric = String(text || "").match(/(\d+)\s*轮/);
  if (numeric) return Math.min(10, Math.max(1, Number.parseInt(numeric[1], 10)));
  const chinese = String(text || "").match(/第?\s*([一二两三四五六七八九十])\s*轮/);
  return chinese ? parseChineseRound(chinese[1]) || 1 : null;
}

function tokenValue(token) {
  if (typeof token === "string") return token;
  if (!token || typeof token !== "object") return "";
  return token.providerId
    ?? token.targetId
    ?? token.resolved
    ?? token.value
    ?? token.alias
    ?? token.raw
    ?? token.id
    ?? "";
}

function normalizeMentionToken(token, index) {
  const value = tokenValue(token);
  const start = Number.isInteger(token?.start) ? token.start : null;
  const end = Number.isInteger(token?.end) ? token.end : null;
  return {
    index,
    raw: typeof token === "string" ? token : String(token?.raw ?? token?.label ?? value),
    resolved: resolveMention(value),
    providerId: resolveMention(value),
    start,
    end: start !== null && end !== null && end >= start ? end : null,
  };
}

function participantIdsFor(session) {
  return (session?.participants || []).map((participant) => participant.id);
}

function normalizeTargetValues(values, participantIds) {
  const participantSet = new Set(participantIds);
  const normalized = [];
  let includesAll = false;
  let supplied = 0;
  for (const value of Array.isArray(values) ? values : []) {
    supplied += 1;
    const resolved = resolveMention(tokenValue(value));
    if (resolved === "all") {
      includesAll = true;
      continue;
    }
    if (participantSet.has(resolved)) normalized.push(resolved);
  }
  return { targets: uniqueProviderIds(normalized), includesAll, supplied };
}

function sessionDefaultTargets(session, participantIds) {
  const configured = session?.routing?.targets
    ?? session?.currentTargets
    ?? session?.defaultTargets
    ?? session?.settings?.defaultTargets;
  const normalized = normalizeTargetValues(configured, participantIds);
  if (normalized.includesAll) return participantIds;
  return normalized.targets.length ? normalized.targets : participantIds;
}

function tokenRanges(tokens) {
  return tokens
    .filter((token) => token.start !== null && token.end !== null)
    .map((token) => ({ start: token.start, end: token.end }));
}

function indexIsExcluded(index, length, ranges) {
  return ranges.some((range) => index < range.end && index + length > range.start);
}

function isAsciiAlias(value) {
  return /^[\x00-\x7F]+$/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractProviderReferences(text, { excludeRanges = [], providers = PROVIDERS } = {}) {
  const source = String(text || "");
  const lowered = source.toLowerCase();
  const candidates = [];
  const aliases = new Map(PROVIDER_ALIASES);
  for (const provider of providers) {
    aliases.set(normalizeProviderAlias(provider.id), provider.id);
    aliases.set(normalizeProviderAlias(provider.label), provider.id);
  }

  for (const [alias, providerId] of aliases) {
    if (!alias || ALL_ALIASES.has(alias)) continue;
    if (isAsciiAlias(alias)) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(alias)}(?![\\p{L}\\p{N}_-])`, "giu");
      for (const match of source.matchAll(pattern)) {
        if (!indexIsExcluded(match.index, match[0].length, excludeRanges)) {
          candidates.push({ providerId, index: match.index, length: match[0].length });
        }
      }
      continue;
    }
    let index = lowered.indexOf(alias);
    while (index >= 0) {
      if (!indexIsExcluded(index, alias.length, excludeRanges)) {
        candidates.push({ providerId, index, length: alias.length });
      }
      index = lowered.indexOf(alias, index + Math.max(alias.length, 1));
    }
  }

  candidates.sort((left, right) => left.index - right.index || right.length - left.length);
  const occupied = [];
  const ordered = [];
  for (const candidate of candidates) {
    if (occupied.some((range) => candidate.index < range.end && candidate.index + candidate.length > range.start)) continue;
    occupied.push({ start: candidate.index, end: candidate.index + candidate.length });
    ordered.push(candidate.providerId);
  }
  return uniqueProviderIds(ordered);
}

function removeConfirmedTokens(text, tokens, legacy = false) {
  const source = String(text || "");
  if (legacy) return source.replace(/@[\p{L}\p{N}_-]+/gu, " ").replace(/\s+/g, " ").trim();
  const ranges = tokenRanges(tokens).sort((left, right) => right.start - left.start);
  let result = source;
  for (const range of ranges) result = `${result.slice(0, range.start)} ${result.slice(range.end)}`;
  for (const token of tokens.filter((candidate) => candidate.start === null)) {
    const raw = String(token.raw || "").trim();
    if (!raw) continue;
    const index = result.toLowerCase().indexOf(raw.toLowerCase());
    if (index >= 0) result = `${result.slice(0, index)} ${result.slice(index + raw.length)}`;
  }
  return result.replace(/\s+/g, " ").trim();
}

function coerceRounds(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? Math.min(10, Math.max(1, parsed)) : null;
}

function parseCommand(command, session, settings, { legacy = false } = {}) {
  const commandObject = typeof command === "object" && command !== null ? command : { text: command };
  const commandText = String(commandObject.text ?? commandObject.commandText ?? "").trim();
  if (!commandText) throw new Error("EMPTY_COMMAND");

  const participantIds = participantIdsFor(session);
  const participantSet = new Set(participantIds);
  const routing = commandObject.routing && typeof commandObject.routing === "object" ? commandObject.routing : {};
  const rawTargets = hasOwn(commandObject, "targets") ? commandObject.targets : routing.targets;
  const rawTokens = hasOwn(commandObject, "mentionTokens")
    ? commandObject.mentionTokens
    : hasOwn(routing, "mentionTokens") ? routing.mentionTokens : [];
  const structuredEnvelope = hasOwn(commandObject, "targets")
    || hasOwn(commandObject, "mentionTokens")
    || hasOwn(routing, "targets")
    || hasOwn(routing, "mentionTokens");
  const legacyMatches = legacy ? extractLegacyMentionMatches(commandText) : [];
  const mentionTokens = legacy
    ? legacyMatches.map((mention, index) => ({ ...mention, index, providerId: mention.resolved }))
    : (Array.isArray(rawTokens) ? rawTokens : []).map(normalizeMentionToken);
  const normalizedTargets = normalizeTargetValues(rawTargets, participantIds);
  const normalizedTokens = normalizeTargetValues(mentionTokens, participantIds);
  const includesAll = normalizedTargets.includesAll || normalizedTokens.includesAll;
  let targets;
  let routingSource;

  if (includesAll) {
    targets = participantIds;
    routingSource = normalizedTargets.includesAll ? "targets" : legacy ? "legacy_mentions" : "mention_tokens";
  } else {
    targets = uniqueProviderIds([...normalizedTargets.targets, ...normalizedTokens.targets]);
    if (targets.length) {
      routingSource = normalizedTargets.targets.length ? "targets" : legacy ? "legacy_mentions" : "mention_tokens";
    } else if (legacy) {
      targets = participantIds;
      routingSource = "legacy_default";
    } else {
      const supplied = normalizedTargets.supplied + normalizedTokens.supplied;
      if (supplied > 0) throw new Error("NO_TARGET_PARTICIPANTS");
      targets = sessionDefaultTargets(session, participantIds);
      routingSource = "session_default";
    }
  }
  if (targets.length === 0) throw new Error("NO_TARGET_PARTICIPANTS");

  const excludeRanges = legacy ? legacyMatches : tokenRanges(mentionTokens);
  const references = extractProviderReferences(commandText, { excludeRanges });
  const instruction = removeConfirmedTokens(commandText, mentionTokens, legacy) || commandText;
  const requestedMode = commandObject.conversationMode ?? commandObject.mode ?? settings.conversationMode;
  const conversationMode = requestedMode === "relay" ? "relay" : "discussion";

  if (conversationMode === "relay") {
    const hostId = session?.hostId || null;
    if (!hostId || !participantSet.has(hostId)) throw new Error("RELAY_HOST_REQUIRED");
    const targetSet = new Set(targets);
    const route = participantIds.filter((providerId) => providerId !== hostId && targetSet.has(providerId));
    route.push(hostId);
    return {
      commandText,
      instruction,
      originalTask: instruction,
      mentions: mentionTokens.map(({ raw, resolved }) => ({ raw, resolved })),
      mentionTokens,
      references,
      targets: uniqueProviderIds(route),
      selectedTargets: targets,
      route: uniqueProviderIds(route),
      hostId,
      rounds: 1,
      mode: "relay",
      conversationMode,
      routingSource,
      structuredRouting: structuredEnvelope && !legacy,
    };
  }

  const rounds = coerceRounds(commandObject.rounds)
    || parseExplicitRounds(commandText)
    || (targets.length > 1 ? settings.defaultRounds : 1);
  return {
    commandText,
    instruction,
    originalTask: instruction,
    mentions: mentionTokens.map(({ raw, resolved }) => ({ raw, resolved })),
    mentionTokens,
    references,
    targets,
    selectedTargets: targets,
    route: [],
    hostId: session?.hostId || null,
    rounds,
    mode: targets.length > 1 ? "discussion" : "direct",
    conversationMode,
    routingSource,
    structuredRouting: structuredEnvelope && !legacy,
  };
}

export function parseStructuredRoundtableCommand(command, session, settings = session?.settings || DEFAULT_SETTINGS) {
  return parseCommand(command, session, settings, { legacy: false });
}

export function parseLegacyRoundtableCommand(text, session, settings = session?.settings || DEFAULT_SETTINGS) {
  return parseCommand({ text }, session, settings, { legacy: true });
}

export function parseRoundtableCommand(command, session, settings = session?.settings || DEFAULT_SETTINGS) {
  if (typeof command === "string") return parseLegacyRoundtableCommand(command, session, settings);
  const routing = command?.routing && typeof command.routing === "object" ? command.routing : {};
  const hasStructuredEnvelope = hasOwn(command, "targets")
    || hasOwn(command, "mentionTokens")
    || hasOwn(routing, "targets")
    || hasOwn(routing, "mentionTokens");
  return hasStructuredEnvelope
    ? parseStructuredRoundtableCommand(command, session, settings)
    : parseLegacyRoundtableCommand(command?.text ?? command?.commandText, session, settings);
}

export function suggestProviderMentions(query, session, providers = PROVIDERS) {
  const normalizedQuery = normalizeMention(query);
  const participantSet = new Set(participantIdsFor(session));
  const suggestions = [];
  for (const provider of providers) {
    if (!participantSet.has(provider.id)) continue;
    const aliases = uniqueProviderIds([
      ...getProviderAliases(provider.id),
      normalizeProviderAlias(provider.id),
      normalizeProviderAlias(provider.label),
    ]);
    const matches = aliases.filter((alias) => !normalizedQuery || alias.startsWith(normalizedQuery));
    if (!matches.length) continue;
    matches.sort((left, right) => {
      const leftExact = left === normalizedQuery ? 0 : 1;
      const rightExact = right === normalizedQuery ? 0 : 1;
      return leftExact - rightExact || left.length - right.length || left.localeCompare(right);
    });
    suggestions.push({
      providerId: provider.id,
      label: provider.label,
      alias: matches[0],
      token: `@${provider.label}`,
    });
  }
  return suggestions;
}

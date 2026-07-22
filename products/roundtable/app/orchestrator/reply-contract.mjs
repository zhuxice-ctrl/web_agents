export const REPLY_SCHEMA = "web-agents-roundtable.reply.v1";

const ARRAY_FIELDS = Object.freeze([
  "claims",
  "evidence",
  "risks",
  "disagreements",
  "actions",
  "missingEvidence",
]);

const SECTION_ALIASES = new Map([
  ["核心判断", "summary"],
  ["结论", "summary"],
  ["主要风险", "risks"],
  ["风险", "risks"],
  ["关键风险", "risks"],
  ["依据", "evidence"],
  ["证据", "evidence"],
  ["主要依据", "evidence"],
  ["行动", "actions"],
  ["下一步", "actions"],
  ["可执行建议", "actions"],
  ["分歧", "disagreements"],
  ["未解决分歧", "disagreements"],
  ["待核验证据", "missingEvidence"],
  ["信息缺口", "missingEvidence"],
  ["关键主张", "claims"],
]);

function cleanText(value, maximum = 4000) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, maximum);
}

function cleanItem(value) {
  if (typeof value === "string") return cleanText(value, 1000);
  if (value && typeof value === "object") return cleanText(value.text || value.content || value.value, 1000);
  return "";
}

function cleanArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanItem).filter(Boolean))].slice(0, 20);
}

function emptyValue(summary = "") {
  return {
    schema: REPLY_SCHEMA,
    summary: cleanText(summary),
    claims: [],
    evidence: [],
    risks: [],
    disagreements: [],
    actions: [],
    missingEvidence: [],
    confidence: "candidate",
    structureConfidence: "low",
  };
}

function valueFromObject(input, structureConfidence) {
  const value = emptyValue(input?.summary || input?.conclusion || "");
  for (const field of ARRAY_FIELDS) value[field] = cleanArray(input?.[field]);
  value.confidence = ["low", "candidate", "review", "high"].includes(input?.confidence)
    ? input.confidence
    : "candidate";
  value.structureConfidence = structureConfidence;
  return value;
}

function findBalancedJson(source) {
  const candidates = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function repairUnescapedQuotationMarks(source) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }
    if (character !== '"') {
      result += character;
      continue;
    }
    let lookahead = index + 1;
    while (/\s/.test(source[lookahead] || "")) lookahead += 1;
    const next = source[lookahead] || "";
    if (!next || [":", ",", "}", "]"].includes(next)) {
      result += character;
      inString = false;
    } else {
      result += '\\"';
    }
  }
  return result;
}

function parseJsonCandidate(candidate) {
  const source = candidate.trim();
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { value: parsed, repaired: false };
  } catch {
    // Try the narrow, auditable repair below.
  }
  if (!source.startsWith("{") || !source.endsWith("}")) return null;
  const repairedSource = repairUnescapedQuotationMarks(source);
  if (repairedSource === source) return null;
  try {
    const parsed = JSON.parse(repairedSource);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { value: parsed, repaired: true };
  } catch {
    return null;
  }
  return null;
}

function extractJsonObject(raw) {
  const source = cleanText(raw, 20000);
  const fenced = [...source.matchAll(/```(?:json|jsonl)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  const broadObject = firstBrace >= 0 && lastBrace > firstBrace ? source.slice(firstBrace, lastBrace + 1) : "";
  const candidates = [...fenced, source, broadObject, ...findBalancedJson(source)].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function sectionName(line) {
  const normalized = line
    .replace(/^\s{0,3}(?:#{1,6}|[-*])\s*/, "")
    .replace(/[：:]\s*$/, "")
    .trim();
  return SECTION_ALIASES.get(normalized) || null;
}

function recoverMarkdown(raw) {
  const lines = cleanText(raw, 20000).split("\n");
  const value = emptyValue("");
  let section = null;
  let summaryFound = false;
  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) continue;
    const inline = line.match(/^(核心判断|结论|主要风险|风险|依据|证据|行动|下一步|可执行建议|分歧|待核验证据|信息缺口|关键主张)[：:]\s*(.+)$/);
    if (inline) {
      section = SECTION_ALIASES.get(inline[1]) || null;
      if (section === "summary") {
        value.summary = cleanText(inline[2]);
        summaryFound = Boolean(value.summary);
      } else if (section) value[section].push(cleanText(inline[2], 1000));
      continue;
    }
    const nextSection = sectionName(line);
    if (nextSection) {
      section = nextSection;
      continue;
    }
    const item = cleanText(line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, ""), 1000);
    if (section === "summary" && !summaryFound) {
      value.summary = item;
      summaryFound = Boolean(item);
    } else if (section && item) value[section].push(item);
    else if (!value.summary) {
      value.summary = item;
      summaryFound = Boolean(item);
    }
  }
  for (const field of ARRAY_FIELDS) value[field] = cleanArray(value[field]);
  return summaryFound && ARRAY_FIELDS.some((field) => value[field].length)
    ? { ...value, structureConfidence: "medium" }
    : null;
}

export function validateRoundtableReply(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["reply must be an object"] };
  if (value.schema !== REPLY_SCHEMA) errors.push("schema must match the roundtable reply contract");
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("summary is required");
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(value[field])) errors.push(`${field} must be an array`);
    else if (value[field].some((item) => typeof item !== "string" || !item.trim())) errors.push(`${field} contains an empty item`);
  }
  if (value.structureConfidence !== "high") errors.push("structureConfidence is not verified");
  return { valid: errors.length === 0, errors };
}

export function normalizeRoundtableReply(raw) {
  const rawContent = cleanText(raw, 50000);
  const extracted = extractJsonObject(rawContent);
  const parsed = extracted?.value || null;
  const hasRequiredFields = parsed
    && parsed.schema === REPLY_SCHEMA
    && typeof parsed.summary === "string"
    && ARRAY_FIELDS.every((field) => Array.isArray(parsed[field]))
    && typeof parsed.confidence === "string";
  if (hasRequiredFields) {
    const value = valueFromObject(parsed, extracted.repaired ? "medium" : "high");
    if (extracted.repaired) {
      return {
        status: "recovered",
        value,
        rawContent,
        errors: ["reply contained repaired unescaped quotation marks"],
      };
    }
    const validation = validateRoundtableReply(value);
    if (validation.valid) return { status: "valid", value, rawContent, errors: [] };
  }
  const recovered = recoverMarkdown(rawContent);
  if (recovered) return { status: "recovered", value: recovered, rawContent, errors: ["reply was recovered from markdown"] };
  return {
    status: "invalid",
    value: emptyValue(rawContent),
    rawContent,
    errors: ["reply did not match JSON contract or recognizable markdown sections"],
  };
}

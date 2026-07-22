const FLAG_DEFINITIONS = Object.freeze({
  possible_off_topic: { label: "可能偏题", severity: "warning" },
  self_promotion: { label: "疑似模型自我宣传", severity: "warning" },
  mojibake: { label: "局部乱码", severity: "warning" },
  duplicate_content: { label: "内容重复", severity: "info" },
  truncated: { label: "回答截断", severity: "warning" },
  prompt_echo: { label: "提示词回显", severity: "warning" },
});

export const QUALITY_FLAGS = Object.freeze(Object.keys(FLAG_DEFINITIONS));

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function addFlag(flags, code, detail = null) {
  if (flags.some((flag) => flag.code === code)) return;
  const definition = FLAG_DEFINITIONS[code];
  flags.push({ code, ...definition, detail });
}

function contentLooksDuplicated(content, previousReplies) {
  const normalized = normalizeText(content);
  if (normalized.length < 12) return false;
  return (previousReplies || []).some((reply) => {
    const previous = normalizeText(typeof reply === "object" ? reply.content : reply);
    if (previous.length < 12) return false;
    if (previous === normalized) return true;
    const shorter = previous.length < normalized.length ? previous : normalized;
    const longer = previous.length < normalized.length ? normalized : previous;
    return shorter.length >= 40 && longer.includes(shorter) && shorter.length / longer.length >= 0.85;
  });
}

function contentLooksOffTopic(content, context) {
  const keywords = Array.isArray(context.expectedKeywords)
    ? context.expectedKeywords.map(normalizeText).filter(Boolean)
    : [];
  if (!keywords.length) return false;
  const normalized = normalizeText(content);
  return !keywords.some((keyword) => normalized.includes(keyword));
}

function contentHasMojibake(content) {
  const source = String(content || "");
  if (/\uFFFD|���/.test(source)) return true;
  const suspicious = source.match(/(?:锛|鐨|涓|浠|缁|闂|鏂|娴|绠)/g) || [];
  return suspicious.length >= 2;
}

export function analyzeReplyQuality(content, context = {}) {
  const rawContent = String(content ?? "");
  const flags = [];
  if (/\[(?:WEB_AGENT_FIXED_INSTRUCTION|ROUND_TABLE_TASK)_(?:BEGIN|END)\]/.test(rawContent)) {
    addFlag(flags, "prompt_echo");
  }
  if (/(?:我是|作为)\s*(?:ChatGPT|GPT|DeepSeek|豆包|Gemini|Qwen|Kimi|GLM|Grok|AI|人工智能|语言模型).{0,40}(?:优先|最好|使用我|选择我|更强|领先)/iu.test(rawContent)) {
    addFlag(flags, "self_promotion");
  }
  if (contentHasMojibake(rawContent)) addFlag(flags, "mojibake");
  if (contentLooksDuplicated(rawContent, context.previousReplies)) addFlag(flags, "duplicate_content");
  if (context.capture?.truncated || context.truncated) addFlag(flags, "truncated");
  if (contentLooksOffTopic(rawContent, context)) addFlag(flags, "possible_off_topic");

  const lowConfidenceCodes = new Set([
    "possible_off_topic",
    "self_promotion",
    "mojibake",
    "truncated",
    "prompt_echo",
  ]);
  const lowConfidence = flags.some((flag) => lowConfidenceCodes.has(flag.code));
  return {
    rawContent,
    structureStatus: context.structureStatus || "unknown",
    flags,
    flagCodes: flags.map((flag) => flag.code),
    confidence: lowConfidence ? "low" : flags.length ? "review" : "candidate",
    lowConfidence,
    blocking: false,
    canContinue: true,
    sideEffectsAllowed: !lowConfidence,
  };
}

export const analyzeQuality = analyzeReplyQuality;

function technicalError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
    error.diagnostics = cause.diagnostics || null;
  }
  return error;
}

export function technicalFailureForResult(result, executionError = null) {
  if (executionError) {
    const code = executionError.code || "PROVIDER_EXECUTION_FAILED";
    return technicalError(code, executionError.message || String(executionError), executionError);
  }
  const capture = result?.capture || {};
  if (capture.failed || result?.captureFailed) {
    return technicalError("CAPTURE_FAILED", capture.message || "Provider reply capture failed.");
  }
  if (!String(result?.text ?? "").trim()) {
    return technicalError("EMPTY_REPLY", "Provider returned an empty reply.");
  }
  if ((capture.truncated && capture.complete === false) || result?.completelyTruncated) {
    return technicalError("REPLY_TRUNCATED", "Provider reply was completely truncated.");
  }
  return null;
}

export function isTechnicalFailure(error) {
  if (!error) return false;
  return !new Set([
    "LOGIN_REQUIRED",
    "AUTH_REQUIRED",
    "VERIFICATION_REQUIRED",
    "CAPTCHA_REQUIRED",
    "HUMAN_VERIFICATION_REQUIRED",
    "PERMISSION_REQUIRED",
    "PERMISSION_DENIED",
    "REQUEST_NOT_APPROVED",
    "WRITE_EXECUTOR_REQUIRED",
    "MANUAL_SEND_REQUIRED",
    "MANUAL_CAPTURE_REQUIRED",
    "RUN_CANCELLED",
    "SEND_UNKNOWN",
  ]).has(error.code);
}

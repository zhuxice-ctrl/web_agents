const CJK_CODE_POINT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const PROMPT_ENVELOPE_TOKENS = 32;

function estimatedRunTokens(value, bytesPerToken) {
  if (!value) return 0;
  return Math.ceil(Buffer.byteLength(value, "utf8") / bytesPerToken);
}

export function estimateTextTokens(value) {
  const text = String(value || "");
  let tokens = 0;
  let asciiRun = "";
  let unicodeRun = "";

  const flush = () => {
    tokens += estimatedRunTokens(asciiRun, 4);
    tokens += estimatedRunTokens(unicodeRun, 2);
    asciiRun = "";
    unicodeRun = "";
  };

  for (const character of text) {
    if (CJK_CODE_POINT.test(character)) {
      flush();
      tokens += 1;
    } else if (character.codePointAt(0) <= 0x7f) {
      if (unicodeRun) flush();
      asciiRun += character;
    } else {
      if (asciiRun) flush();
      unicodeRun += character;
    }
  }
  flush();
  return tokens;
}

export function estimatePromptTokens(prompt) {
  return estimateTextTokens(prompt) + PROMPT_ENVELOPE_TOKENS;
}


export function parseParticipationResult(value) {
  const content = String(value ?? "").trim();
  if (!content) return { kind: "invalid", content: null };
  if (/^pass$/iu.test(content)) return { kind: "passed", content: null };
  return { kind: "spoken", content };
}

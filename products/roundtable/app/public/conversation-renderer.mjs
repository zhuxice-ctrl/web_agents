export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function markdownForEvent(event = {}) {
  return String(event.content || "");
}

export function renderSafeMarkdown(source, { parse, sanitize } = {}) {
  const text = String(source ?? "");
  const parser = parse || globalThis.marked?.parse;
  const cleaner = sanitize || globalThis.DOMPurify?.sanitize;
  try {
    if (typeof parser !== "function" || typeof cleaner !== "function") throw new Error("MARKDOWN_RUNTIME_UNAVAILABLE");
    const dirty = parser(text, { gfm: true, breaks: false });
    return cleaner(dirty, {
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "svg", "math"],
      FORBID_ATTR: ["style", "onerror", "onclick", "onload", "onmouseover"],
    });
  } catch {
    return `<p class="markdown-fallback">${escapeHtml(text).replaceAll("\n", "<br>")}</p>`;
  }
}

export function hardenRenderedLinks(root, { origin = globalThis.location?.origin || "http://127.0.0.1" } = {}) {
  for (const anchor of root?.querySelectorAll?.("a[href]") || []) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href, origin); } catch { anchor.removeAttribute("href"); continue; }
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      anchor.removeAttribute("href");
      continue;
    }
    if (parsed.protocol === "mailto:" || parsed.origin !== origin) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }
}

const DEFAULT_BOTTOM_THRESHOLD = 24;

export function isConversationAtBottom(scroller, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  if (!scroller) return true;
  const distance = Math.max(
    0,
    Number(scroller.scrollHeight || 0)
      - Number(scroller.clientHeight || 0)
      - Number(scroller.scrollTop || 0),
  );
  return distance <= threshold;
}

export function createConversationScrollController({
  scroller,
  button,
  reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
} = {}) {
  if (!scroller || !button) throw new TypeError("Conversation scroller and button are required");

  let generating = false;
  let hasContent = false;
  let scrollingToBottom = false;

  function updateVisibility() {
    const atBottom = isConversationAtBottom(scroller, bottomThreshold);
    if (scrollingToBottom && atBottom) scrollingToBottom = false;
    button.hidden = scrollingToBottom
      || generating
      || !hasContent
      || atBottom;
  }

  function preserveScroll(render) {
    const scrollTop = Number(scroller.scrollTop || 0);
    render();
    scroller.scrollTop = scrollTop;
  }

  function setState(next = {}) {
    generating = next.generating === true;
    hasContent = next.hasContent === true;
    updateVisibility();
  }

  function scrollToBottom() {
    scrollingToBottom = true;
    button.hidden = true;
    scroller.scrollTo?.({
      top: Number(scroller.scrollHeight || 0),
      behavior: reducedMotion ? "auto" : "smooth",
    });
    if (typeof scroller.scrollTo !== "function") {
      scroller.scrollTop = Number(scroller.scrollHeight || 0);
    }
  }

  scroller.addEventListener?.("scroll", updateVisibility, { passive: true });
  button.addEventListener?.("click", scrollToBottom);
  updateVisibility();

  return {
    preserveScroll,
    scrollToBottom,
    setState,
    updateVisibility,
  };
}

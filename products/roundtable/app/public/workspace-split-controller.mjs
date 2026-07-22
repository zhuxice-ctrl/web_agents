export const WORKSPACE_SPLIT_STORAGE_KEY = "web-agents-roundtable:conversation-width-percent";

const DEFAULT_PERCENT = 39;
const MIN_CONVERSATION_PX = 340;
const MIN_STAGE_PX = 360;
const DIVIDER_PX = 8;

function formatPercent(value) {
  return String(Number(Number(value).toFixed(1)));
}

function splitBounds({
  width,
  dividerPx = DIVIDER_PX,
  minConversationPx = MIN_CONVERSATION_PX,
  minStagePx = MIN_STAGE_PX,
} = {}) {
  const availableWidth = Math.max(1, Number(width) || 1);
  const minimum = (minConversationPx / availableWidth) * 100;
  const maximum = ((availableWidth - minStagePx - dividerPx) / availableWidth) * 100;
  if (maximum < minimum) {
    const fallback = Math.max(0, Math.min(100, ((availableWidth - dividerPx) / 2 / availableWidth) * 100));
    return { minimum: fallback, maximum: fallback };
  }
  return {
    minimum: Math.max(0, minimum),
    maximum: Math.min(100, maximum),
  };
}

export function clampConversationPercent(percent, options = {}) {
  const { minimum, maximum } = splitBounds(options);
  const requested = Number.isFinite(Number(percent)) ? Number(percent) : DEFAULT_PERCENT;
  return Number(formatPercent(Math.max(minimum, Math.min(maximum, requested))));
}

export function createWorkspaceSplitController({
  workspace,
  separator,
  storage,
  mediaQuery,
  resizeTarget,
} = {}) {
  if (!workspace || !separator) throw new Error("WORKSPACE_SPLIT_ELEMENTS_REQUIRED");
  let currentPercent = DEFAULT_PERCENT;
  let activePointerId = null;

  const bounds = () => splitBounds({ width: workspace.getBoundingClientRect().width });

  const apply = (percent, { persist = false } = {}) => {
    currentPercent = clampConversationPercent(percent, { width: workspace.getBoundingClientRect().width });
    const formatted = formatPercent(currentPercent);
    const { minimum, maximum } = bounds();
    workspace.style.setProperty("--conversation-width", `${formatted}%`);
    separator.setAttribute("aria-valuemin", formatPercent(minimum));
    separator.setAttribute("aria-valuemax", formatPercent(maximum));
    separator.setAttribute("aria-valuenow", formatted);
    if (persist) {
      try { storage?.setItem(WORKSPACE_SPLIT_STORAGE_KEY, formatted); } catch { }
    }
    return currentPercent;
  };

  const applyPointer = (event, persist = false) => {
    const rect = workspace.getBoundingClientRect();
    const requested = ((rect.right - Number(event.clientX || 0)) / Math.max(1, rect.width)) * 100;
    apply(requested, { persist });
  };

  const syncResponsiveState = () => {
    const disabled = Boolean(mediaQuery?.matches);
    separator.setAttribute("aria-disabled", String(disabled));
    separator.tabIndex = disabled ? -1 : 0;
    if (!disabled) apply(currentPercent);
  };

  return {
    initialize() {
      let saved = DEFAULT_PERCENT;
      try {
        const parsed = Number(storage?.getItem(WORKSPACE_SPLIT_STORAGE_KEY));
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 100) saved = parsed;
      } catch { }
      apply(saved);
      syncResponsiveState();

      separator.addEventListener("pointerdown", (event) => {
        if (mediaQuery?.matches) return;
        activePointerId = event.pointerId;
        separator.setPointerCapture?.(event.pointerId);
        applyPointer(event);
        event.preventDefault?.();
      });
      separator.addEventListener("pointermove", (event) => {
        if (event.pointerId !== activePointerId) return;
        applyPointer(event);
        event.preventDefault?.();
      });
      const finishPointer = (event) => {
        if (event.pointerId !== activePointerId) return;
        apply(currentPercent, { persist: true });
        separator.releasePointerCapture?.(event.pointerId);
        activePointerId = null;
      };
      separator.addEventListener("pointerup", finishPointer);
      separator.addEventListener("pointercancel", finishPointer);
      separator.addEventListener("keydown", (event) => {
        if (mediaQuery?.matches) return;
        const { minimum, maximum } = bounds();
        const requested = event.key === "ArrowLeft" ? currentPercent + 2
          : event.key === "ArrowRight" ? currentPercent - 2
            : event.key === "Home" ? minimum
              : event.key === "End" ? maximum : null;
        if (requested === null) return;
        event.preventDefault?.();
        apply(requested, { persist: true });
      });
      mediaQuery?.addEventListener?.("change", syncResponsiveState);
      resizeTarget?.addEventListener?.("resize", () => apply(currentPercent));
    },
    get value() { return currentPercent; },
    set(percent, { persist = true } = {}) { return apply(percent, { persist }); },
  };
}

export const DETAIL_SIDEBAR_STORAGE_KEY = "web-agents-roundtable:detail-sidebar-collapsed";

export function createDetailSidebarController({
  workspace,
  sidebar,
  collapseButton,
  restoreButton,
  storage,
} = {}) {
  if (!workspace || !sidebar || !collapseButton || !restoreButton) {
    throw new Error("DETAIL_SIDEBAR_ELEMENTS_REQUIRED");
  }

  const apply = (collapsed, { persist = true } = {}) => {
    workspace.classList.toggle("is-detail-collapsed", collapsed);
    sidebar.hidden = collapsed;
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    restoreButton.setAttribute("aria-expanded", String(!collapsed));
    restoreButton.hidden = !collapsed;
    if (persist) {
      try { storage?.setItem(DETAIL_SIDEBAR_STORAGE_KEY, String(collapsed)); } catch { }
    }
  };

  return {
    initialize() {
      let collapsed = false;
      try { collapsed = storage?.getItem(DETAIL_SIDEBAR_STORAGE_KEY) === "true"; } catch { }
      apply(collapsed, { persist: false });
      collapseButton.addEventListener("click", () => apply(true));
      restoreButton.addEventListener("click", () => apply(false));
    },
    collapse() { apply(true); },
    restore() { apply(false); },
  };
}

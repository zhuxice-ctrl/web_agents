const BOTTOM_THRESHOLD = 24;

function findDetails(node) {
  if (!node) return null;
  if (node.matches?.("details")) return node;
  return node.querySelector?.("details") || null;
}

function findScroller(node) {
  if (!node) return null;
  if (node.matches?.("[data-progress-scroll]")) return node;
  return node.querySelector?.("[data-progress-scroll]") || null;
}

export function captureProgressView(node) {
  const details = findDetails(node);
  const scroller = findScroller(node);
  if (!details || !scroller) return { open: true, follow: true, scrollTop: 0 };
  const distance = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0) - Number(scroller.scrollTop || 0));
  return {
    open: details.open !== false,
    follow: distance <= BOTTOM_THRESHOLD,
    scrollTop: Number(scroller.scrollTop || 0),
  };
}

export function restoreProgressView(node, view = {}) {
  const details = findDetails(node);
  const scroller = findScroller(node);
  if (!details || !scroller) return;
  details.open = view.open !== false;
  if (!details.open) return;
  if (view.follow !== false) {
    scroller.scrollTop = Number(scroller.scrollHeight || 0);
    return;
  }
  const maxScrollTop = Math.max(0, Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0));
  scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(view.scrollTop || 0)));
}

export function bindProgressDisclosure(node) {
  const details = findDetails(node);
  const scroller = findScroller(node);
  if (!details || !scroller || details.dataset.progressBound === "true") return;
  details.dataset.progressBound = "true";
  details.addEventListener?.("toggle", () => {
    if (details.open) scroller.scrollTop = Number(scroller.scrollHeight || 0);
  });
}

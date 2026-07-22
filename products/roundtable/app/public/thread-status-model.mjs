function liveBindingFor(thread, liveBindings) {
  const providerId = String(thread?.providerId || "");
  const threadKey = String(thread?.threadKey || "");
  return (Array.isArray(liveBindings) ? liveBindings : []).find((binding) =>
    String(binding?.providerId || "") === providerId
      && String(binding?.threadKey || "") === threadKey
      && binding?.closed !== true
      && binding?.status === "verified"
  ) || null;
}

export function resolveThreadStatus(thread = {}, liveBindings = []) {
  const value = String(thread.status || "unprovisioned");
  const selectors = thread.diagnostics?.selectors;
  const detail = Array.isArray(selectors) && selectors.length ? `探测选择器：${selectors.join("、")}` : "";

  if (value === "verified") {
    if (liveBindingFor(thread, liveBindings)) return { state: "verified", className: "is-ready", label: "线程可用", detail };
    return {
      state: "needs_reconnect",
      className: "is-waiting",
      label: "需要重新连接",
      detail: "当前会话没有可用的网页绑定",
    };
  }
  if (["waiting_login", "waiting_verification"].includes(value)) {
    return { state: value, className: "is-waiting", label: value === "waiting_login" ? "等待登录" : "等待验证", detail };
  }
  if (["manual_binding", "opening", "unprovisioned", "composer_missing"].includes(value)) {
    return {
      state: value,
      className: value === "composer_missing" ? "is-waiting" : "is-waiting",
      label: value === "composer_missing" ? "输入框未找到" : "线程待就绪",
      detail,
    };
  }
  return { state: value, className: "is-error", label: "线程异常", detail };
}

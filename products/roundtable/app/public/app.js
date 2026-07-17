import {
  acceptSuggestion,
  buildSendPreview,
  getComposerSuggestions,
  removeToken,
} from "./composer-model.mjs";
import { findSnappedHost, HOST_POINT, stepRoundtablePhysics } from "./roundtable-physics.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  health: null,
  providers: [],
  workspaceRegistry: { selected: null, workspaces: [] },
  sessions: [],
  session: null,
  audit: [],
  tokens: [{ id: "all", label: "全体", kind: "all" }],
  rounds: 3,
  conversationMode: "discussion",
  suggestions: { range: null, suggestions: [], activeIndex: 0 },
  composing: false,
  activeRun: null,
  eventSource: null,
  refreshTimer: null,
  permission: null,
  layoutNodes: [],
  dragging: null,
  animationFrame: null,
  lastFrame: performance.now(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const payload = await response.json().catch(() => ({ ok: false, error: `HTTP_${response.status}` }));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || payload.code || `HTTP_${response.status}`);
    error.code = payload.code || payload.error || null;
    error.diagnostics = payload.diagnostics || null;
    throw error;
  }
  return payload;
}

function showToast(message, { error = false, timeout = 4800 } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast${error ? " is-error" : ""}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button class="icon-button" type="button" aria-label="关闭">×</button>`;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  $("#toastRegion").prepend(toast);
  setTimeout(() => toast.remove(), timeout);
}

function providerById(providerId) {
  return state.providers.find((provider) => provider.id === providerId) || state.session?.participants?.find((provider) => provider.id === providerId) || { id: providerId, label: providerId };
}

function currentSettings() {
  return {
    defaultRounds: state.rounds,
    conversationMode: state.conversationMode,
    mode: state.health?.browser?.mode === "extension" ? "extension" : "playwright",
    autoSend: true,
    autoCapture: true,
    maxContextEvents: Number($("#maxContextEvents").value || 24),
    providerConcurrency: Number($("#providerConcurrency").value || 3),
    handoffThreshold: Number($("#handoffThreshold").value || 72),
    urgentHandoffThreshold: Number($("#urgentHandoffThreshold").value || 90),
  };
}

function activeRunId() {
  return state.activeRun?.runId || state.session?.runtime?.activeRunId || null;
}

function sessionStatus() {
  const status = state.activeRun?.status || state.session?.runtime?.status || "idle";
  const labels = {
    idle: "未运行",
    running: "正在运行",
    queued: "排队等待",
    paused: "已暂停",
    waiting_recovery: "等待恢复",
    waiting_login: "等待登录",
    completed: "已完成",
    failed: "执行异常",
    cancelled: "已终止",
  };
  return { status, label: labels[status] || status };
}

function renderTopbar() {
  const workspace = state.workspaceRegistry.selected;
  $("#workspaceName").textContent = workspace?.name || "未选择";
  $("#workspaceButton").title = workspace?.root || "选择工作区";
  $("#appShell").classList.toggle("is-locked", !workspace);
  const { status, label } = sessionStatus();
  const badge = $("#sessionState");
  badge.className = `status-badge ${["running"].includes(status) ? "is-running" : ["paused", "waiting_recovery", "waiting_login", "queued"].includes(status) ? "is-waiting" : ["failed", "cancelled"].includes(status) ? "is-error" : "is-idle"}`;
  badge.innerHTML = `<i></i>${escapeHtml(label)}`;
  $("#renameSessionButton").disabled = !state.session;
  $("#newSessionButton").disabled = !workspace;
  $("#addParticipantButton").disabled = !state.session;
}

function renderSessionOptions() {
  const select = $("#sessionSelectTop");
  if (!state.sessions.length) {
    select.innerHTML = '<option value="">未创建圆桌</option>';
    select.value = "";
    return;
  }
  select.innerHTML = state.sessions.map((session) => {
    const prefix = session.status === "running" ? "● " : session.status === "paused" ? "Ⅱ " : session.unreadCount ? `(${session.unreadCount}) ` : "";
    return `<option value="${escapeHtml(session.id)}">${escapeHtml(prefix + session.title)}</option>`;
  }).join("");
  select.value = state.session?.id || "";
}

function threadStatus(thread) {
  const value = thread?.status || "unprovisioned";
  if (["verified", "ready", "opened"].includes(value)) return { className: "is-ready", label: "线程可用" };
  if (["waiting_login", "waiting_verification", "waiting_user", "manual_binding", "opening", "unprovisioned", "composer_missing"].includes(value)) {
    const label = value === "waiting_login" ? "等待登录" : value === "waiting_verification" ? "等待验证" : value === "manual_binding" ? "等待绑定" : "线程待就绪";
    return { className: "is-waiting", label };
  }
  return { className: "is-error", label: "线程异常" };
}

function capacityFor(thread) {
  const used = Number(thread?.deliveredChars || 0) + Number(thread?.capturedChars || 0);
  const percent = Math.max(0, Math.min(100, Math.round((used / 120000) * 100)));
  return { used, percent, recommendation: percent >= 90 ? "尽快交接" : percent >= 72 ? "建议交接" : "可继续" };
}

function renderParticipants() {
  const root = $("#participantList");
  if (!state.session?.participants?.length) {
    root.className = "participant-list empty-state";
    root.innerHTML = "<p>创建圆桌后选择模型入席</p>";
    return;
  }
  root.className = "participant-list";
  root.innerHTML = state.session.participants.map((participant) => {
    const thread = state.session.threads?.[participant.id];
    const status = threadStatus(thread);
    const capacity = capacityFor(thread);
    const cursor = state.session.context?.seatCursors?.[participant.id] ?? thread?.lastDeliveredEventIndex ?? -1;
    const total = state.session.events?.length || 0;
    const synced = Math.min(total, Math.max(0, cursor + 1));
    return `
      <div class="participant-row" data-provider-id="${escapeHtml(participant.id)}">
        <span class="participant-avatar">${escapeHtml(participant.label.slice(0, 2))}<i class="${status.className}"></i></span>
        <span class="participant-info"><strong>${escapeHtml(participant.label)}</strong><small>${escapeHtml(status.label)} · 同步 ${synced}/${total}</small><span class="participant-progress"><i style="width:${capacity.percent}%"></i></span></span>
        <button class="participant-menu" type="button" aria-label="${escapeHtml(participant.label)} 席位菜单">•••</button>
        <span class="participant-actions">
          <button type="button" data-action="handoff">交接包</button>
          <button type="button" data-action="remove">离席</button>
        </span>
      </div>`;
  }).join("");
}

function initializeLayoutNodes() {
  if (!state.session) {
    state.layoutNodes = [];
    return;
  }
  const previous = new Map(state.layoutNodes.map((node) => [node.id, node]));
  const total = Math.max(1, state.session.participants.length);
  state.layoutNodes = state.session.participants.map((participant, index) => {
    const stored = state.session.layout?.[participant.id];
    const existing = previous.get(participant.id);
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
    return {
      id: participant.id,
      x: Number(stored?.x ?? existing?.x ?? 0.5 + Math.cos(angle) * 0.36),
      y: Number(stored?.y ?? existing?.y ?? 0.48 + Math.sin(angle) * 0.32),
      vx: Number(existing?.vx || 0),
      vy: Number(existing?.vy || 0),
    };
  });
}

function renderRoundtable() {
  const root = $("#roundtableSeats");
  if (!state.session) {
    root.innerHTML = "";
    $("#roundtableEyebrow").textContent = "未命名圆桌";
    $("#roundtableObjective").textContent = "从底部输入第一条议题";
    $("#roundProgress").textContent = "0 / 0";
    state.layoutNodes = [];
    return;
  }
  $("#roundtableEyebrow").textContent = state.session.title;
  $("#roundtableObjective").textContent = state.session.objective || state.session.events?.find((event) => event.type === "command")?.content || "等待第一条指令";
  const activePlan = [...(state.session.plans || [])].reverse().find((plan) => ["running", "waiting_recovery", "completed"].includes(plan.status));
  const completedRounds = Math.max(0, ...(activePlan?.turns || []).filter((turn) => turn.status === "completed" && turn.role !== "closure").map((turn) => Number(turn.round || 0)));
  $("#roundProgress").textContent = activePlan ? `${completedRounds} / ${activePlan.rounds}${activePlan.status === "completed" ? " · 已收束" : ""}` : "0 / 0";
  initializeLayoutNodes();
  root.innerHTML = state.session.participants.map((participant) => {
    const thread = state.session.threads?.[participant.id];
    const status = threadStatus(thread);
    const capacity = capacityFor(thread);
    return `<button class="seat-node${state.session.hostId === participant.id ? " is-host" : ""}" type="button" data-provider-id="${escapeHtml(participant.id)}" title="拖动席位；东家仅在上方吸附点生效">
      <span class="capacity-ring" style="--capacity:${capacity.percent}%"><b>${capacity.percent}%</b></span>
      <span class="seat-copy"><strong>${escapeHtml(participant.label)}</strong><small>${escapeHtml(status.label)} · ${escapeHtml(capacity.recommendation)}</small></span>
    </button>`;
  }).join("");
  applyNodePositions();
}

function applyNodePositions() {
  for (const node of state.layoutNodes) {
    const element = $(`.seat-node[data-provider-id="${CSS.escape(node.id)}"]`);
    if (!element) continue;
    element.style.left = `${node.x * 100}%`;
    element.style.top = `${node.y * 100}%`;
    element.classList.toggle("is-dragging", state.dragging?.id === node.id);
  }
}

function animateRoundtable(now) {
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000 || 1 / 60);
  state.lastFrame = now;
  if (state.layoutNodes.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.layoutNodes = stepRoundtablePhysics(state.layoutNodes, {
      dt,
      draggingId: state.dragging?.id || null,
      hostId: state.session?.hostId || null,
    });
    applyNodePositions();
  }
  state.animationFrame = requestAnimationFrame(animateRoundtable);
}

function eventSpeaker(event) {
  if (event.type === "command" && !event.providerId) return "你";
  if (event.type === "closure") return `${providerById(event.providerId).label} · 收束`;
  return event.providerId ? providerById(event.providerId).label : "系统";
}

function renderConversation() {
  const root = $("#chatStream");
  const events = state.session?.events || [];
  $("#eventCount").textContent = String(events.length);
  if (!events.length) {
    root.className = "chat-stream empty-state";
    root.innerHTML = "<p>第一条消息会命名当前圆桌，并进入公共上下文。</p>";
    return;
  }
  root.className = "chat-stream";
  root.innerHTML = events.map((event) => {
    const qualityFlags = event.metadata?.qualityFlags || [];
    const time = event.createdAt ? new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    return `<article class="chat-event${event.type === "command" ? " is-command" : ""}${event.type === "closure" || event.metadata?.closure ? " is-closure" : ""}">
      <div class="event-meta"><strong>${escapeHtml(eventSpeaker(event))}</strong><time>${escapeHtml(time)}${event.round ? ` · R${event.round}` : ""}</time></div>
      <div class="event-content">${escapeHtml(event.content)}${qualityFlags.length ? `<div class="quality-flags">${qualityFlags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}</div>` : ""}</div>
    </article>`;
  }).join("");
  root.scrollTop = root.scrollHeight;
}

function renderPlan() {
  const root = $("#planView");
  const plan = state.session?.plans?.at(-1);
  const turns = plan?.turns || [];
  $("#planCount").textContent = String(turns.length);
  if (!plan) {
    root.className = "detail-list empty-state";
    root.innerHTML = "<p>发送指令后显示轮次与队列</p>";
    return;
  }
  root.className = "detail-list";
  root.innerHTML = turns.map((turn) => `<div class="detail-item"><div class="detail-item-head"><strong>${escapeHtml(turn.providerLabel || providerById(turn.providerId).label)}</strong><span>${escapeHtml(turn.status)}</span></div><p>${turn.role === "closure" ? "自动收束" : turn.role === "host_summary" ? "东家汇报" : `第 ${turn.round || 1} 轮${turn.stage ? ` · ${turn.stage}` : ""}`}</p></div>`).join("");
}

function renderFiles() {
  $("#workspacePath").textContent = state.workspaceRegistry.selected?.root || "未选择工作区";
  const artifacts = state.session?.artifacts || [];
  const transactions = state.session?.transactions || [];
  $("#artifactCount").textContent = String(artifacts.length + transactions.length);
  const root = $("#fileView");
  const items = [
    ...transactions.map((transaction) => ({ type: "transaction", id: transaction.id, label: `事务 ${transaction.id.slice(0, 8)}`, status: transaction.status, path: (transaction.paths || []).join("\n") })),
    ...artifacts.map((artifact) => ({ type: "artifact", id: artifact.id, label: artifact.label, status: artifact.status, path: artifact.targetPath })),
  ];
  if (!items.length) {
    root.className = "detail-list empty-state";
    root.innerHTML = "<p>事务产物会显示在这里</p>";
    return;
  }
  root.className = "detail-list";
  root.innerHTML = items.map((item) => `<div class="detail-item"><div class="detail-item-head"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.status || "active")}</span></div><p>${escapeHtml(item.path || "")}</p>${item.status === "active" || item.status === "committed" ? `<button class="secondary-button" type="button" data-rollback-type="${item.type}" data-rollback-id="${escapeHtml(item.id)}">回撤</button>` : ""}</div>`).join("");
}

function renderAudit() {
  $("#auditCount").textContent = String(state.audit.length);
  const root = $("#auditView");
  if (!state.audit.length) {
    root.className = "detail-list empty-state";
    root.innerHTML = "<p>本地读写和恢复操作均会留痕</p>";
    return;
  }
  root.className = "detail-list";
  root.innerHTML = [...state.audit].reverse().slice(0, 80).map((event) => `<div class="detail-item"><div class="detail-item-head"><strong>${escapeHtml(event.kind || event.type || "event")}</strong><span>${escapeHtml(new Date(event.at || event.createdAt || Date.now()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))}</span></div><p>${escapeHtml(event.path || event.operation || event.transactionId || "")}</p></div>`).join("");
}

function renderComposerTokens() {
  const root = $("#mentionTokens");
  root.innerHTML = state.tokens.map((token) => `<span class="mention-token" data-token-id="${escapeHtml(token.id)}">@${escapeHtml(token.label)}<button type="button" aria-label="移除 ${escapeHtml(token.label)}">×</button></span>`).join("");
}

function composerPreview() {
  return buildSendPreview({
    tokens: state.tokens,
    participants: state.session?.participants || [],
    providers: state.providers,
    text: $("#commandInput").value,
    conversationMode: state.conversationMode,
    rounds: state.rounds,
  });
}

function renderSendPreview() {
  const preview = composerPreview();
  $("#sendPreview").innerHTML = [
    `本轮发言：${preview.targetLabels.join("、") || "未选择"}`,
    `模式：${preview.mode}`,
    `轮数：${preview.rounds}`,
    `文本提及：${preview.referenceLabels.join("、") || "无"}`,
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  $("#sendButton").disabled = !preview.valid || Boolean(activeRunId());
  $("#roundValue").textContent = state.conversationMode === "relay" ? "1" : String(state.rounds);
  $$(".round-stepper button").forEach((button) => { button.disabled = state.conversationMode === "relay"; });
}

function renderSuggestions() {
  const root = $("#mentionSuggestions");
  const suggestions = state.suggestions.suggestions;
  if (!suggestions.length) {
    root.hidden = true;
    root.innerHTML = "";
    return;
  }
  root.hidden = false;
  root.innerHTML = suggestions.map((suggestion, index) => `<button class="suggestion-item${index === state.suggestions.activeIndex ? " is-active" : ""}" type="button" role="option" data-suggestion-index="${index}"><span class="participant-avatar">${escapeHtml(suggestion.label.slice(0, 2))}</span><strong>${escapeHtml(suggestion.label)}</strong><kbd>${index === 0 ? "Tab" : ""}</kbd></button>`).join("");
}

function renderRuntimeDetails() {
  const health = state.health;
  const browser = health?.browser || {};
  $("#runtimeDetails").innerHTML = [
    `圆桌 3020: ${health?.ok ? "healthy" : "unknown"}`,
    `Chrome CDP: ${browser.connected ? "connected" : "waiting"}`,
    `模式: ${browser.mode || "unknown"}`,
    `活动运行: ${health?.activeRuns?.length || 0}`,
    `工作区: ${state.workspaceRegistry.selected?.root || "not selected"}`,
  ].map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

function renderAll() {
  renderTopbar();
  renderSessionOptions();
  renderParticipants();
  renderRoundtable();
  renderConversation();
  renderPlan();
  renderFiles();
  renderAudit();
  renderComposerTokens();
  renderSendPreview();
  renderRuntimeDetails();
}

async function loadSession(sessionId, { reconnect = true } = {}) {
  if (!sessionId) {
    state.session = null;
    state.audit = [];
    state.activeRun = null;
    renderAll();
    return;
  }
  const previousSessionId = state.session?.id || null;
  const [sessionResult, auditResult] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(sessionId)}`),
    api(`/api/sessions/${encodeURIComponent(sessionId)}/audit`).catch(() => ({ audit: [] })),
  ]);
  state.session = sessionResult.session;
  state.audit = auditResult.audit || [];
  const settings = state.session.settings || {};
  state.rounds = Number(settings.defaultRounds || state.rounds || 3);
  state.conversationMode = settings.conversationMode === "relay" ? "relay" : "discussion";
  const modeInput = $(`input[name="conversationMode"][value="${state.conversationMode}"]`);
  if (modeInput) modeInput.checked = true;
  $("#maxContextEvents").value = settings.maxContextEvents || 24;
  state.activeRun = state.health?.activeRuns?.find((run) => run.sessionId === state.session.id) || null;
  if (previousSessionId !== state.session.id) {
    state.tokens = [{ id: "all", label: "全体", kind: "all" }];
  }
  if (reconnect) connectEvents(sessionId);
  renderAll();
}

async function refreshRuntime({ preserveSession = true } = {}) {
  const [health, providers, workspaces] = await Promise.all([
    api("/api/health"),
    api("/api/providers"),
    api("/api/workspaces"),
  ]);
  state.health = health;
  state.providers = providers.providers || [];
  state.workspaceRegistry = { selected: workspaces.selected || null, workspaces: workspaces.workspaces || [] };
  if (!state.workspaceRegistry.selected) {
    state.sessions = [];
    state.session = null;
    renderAll();
    renderRecentWorkspaces();
    if (!$("#workspaceDialog").open) $("#workspaceDialog").showModal();
    return;
  }
  const sessionResult = await api("/api/sessions");
  state.sessions = sessionResult.sessions || [];
  const selectedId = preserveSession && state.session && state.sessions.some((session) => session.id === state.session.id)
    ? state.session.id
    : state.sessions[0]?.id || null;
  if (selectedId) await loadSession(selectedId, { reconnect: !state.eventSource });
  else renderAll();
  await refreshPendingPermission();
}

function scheduleRefresh(delay = 150) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    if (state.session) void loadSession(state.session.id, { reconnect: false }).catch(() => {});
    void refreshPendingPermission();
  }, delay);
}

function connectEvents(sessionId) {
  state.eventSource?.close();
  if (!sessionId) return;
  const source = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`);
  source.onmessage = () => scheduleRefresh();
  for (const eventName of ["plan.started", "turn.started", "turn.completed", "turn.failed", "round.completed", "plan.completed", "plan.failed", "handoff.completed", "permission.requested", "transaction.completed"]) {
    source.addEventListener(eventName, () => scheduleRefresh());
  }
  source.onerror = () => { source.close(); setTimeout(() => state.session?.id === sessionId && connectEvents(sessionId), 2500); };
  state.eventSource = source;
}

function renderRecentWorkspaces() {
  const root = $("#recentWorkspaces");
  const workspaces = state.workspaceRegistry.workspaces || [];
  root.innerHTML = workspaces.length ? workspaces.map((workspace) => `<button type="button" data-workspace-path="${escapeHtml(workspace.root)}">${escapeHtml(workspace.name)}<br><small>${escapeHtml(workspace.root)}</small></button>`).join("") : "";
}

function renderNewSessionProviders() {
  const root = $("#newSessionProviders");
  root.innerHTML = state.providers.map((provider) => {
    const enabled = provider.automation === "mvp";
    const checked = ["deepseek", "doubao"].includes(provider.id);
    return `<label class="provider-option"><input type="checkbox" name="newProvider" value="${escapeHtml(provider.id)}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"} /><span>${escapeHtml(provider.label)}${enabled ? "" : "（待适配）"}</span></label>`;
  }).join("");
}

function renderParticipantChoices() {
  const seated = new Set(state.session?.participants?.map((participant) => participant.id) || []);
  const options = state.providers.filter((provider) => provider.automation === "mvp" && !seated.has(provider.id));
  $("#participantProvider").innerHTML = options.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}</option>`).join("");
  return options.length;
}

function updateSuggestions() {
  if (state.composing) return;
  const input = $("#commandInput");
  const result = getComposerSuggestions({
    text: input.value,
    cursor: input.selectionStart,
    participants: state.session?.participants || [],
    providers: state.providers,
  });
  state.suggestions = { ...result, activeIndex: 0 };
  renderSuggestions();
  renderSendPreview();
}

function chooseSuggestion(index = state.suggestions.activeIndex) {
  const suggestion = state.suggestions.suggestions[index];
  if (!suggestion) return false;
  const input = $("#commandInput");
  const result = acceptSuggestion({
    text: input.value,
    range: state.suggestions.range,
    suggestion,
    tokens: state.tokens,
  });
  input.value = result.text;
  state.tokens = result.tokens;
  state.suggestions = { range: null, suggestions: [], activeIndex: 0 };
  renderComposerTokens();
  renderSuggestions();
  renderSendPreview();
  input.focus();
  return true;
}

async function refreshPendingPermission() {
  if (!state.workspaceRegistry.selected) return;
  try {
    const result = await api("/api/permissions/pending");
    const pending = result.requests?.[0] || null;
    if (!pending) {
      state.permission = null;
      refreshRecoveryDialog();
      return;
    }
    if (state.permission?.id === pending.id) return;
    state.permission = pending;
    if ($("#recoveryDialog").open) $("#recoveryDialog").close();
    $("#permissionRequestId").value = pending.id;
    $("#permissionDetails").innerHTML = [
      ["操作", pending.operation || pending.toolName],
      ["目标路径", (pending.paths || []).join("\n")],
      ["预计修改", pending.summary || "由本地事务管理器执行并保留回撤快照"],
      ["回撤方式", pending.reversible === false ? "不可自动回撤" : "按事务 ID 回撤"],
    ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value || "")}</p></div>`).join("");
    if (!$("#permissionDialog").open) $("#permissionDialog").showModal();
  } catch (error) {
    if (!["NOT_FOUND", "HTTP_404"].includes(error.message)) console.debug("permission poll", error.message);
  }
}

function refreshRecoveryDialog() {
  const dialog = $("#recoveryDialog");
  const runtime = state.session?.runtime;
  if (!runtime || runtime.status !== "waiting_recovery" || state.permission) {
    if (dialog.open) dialog.close();
    return;
  }
  const plan = state.session.plans?.find((candidate) => candidate.id === runtime.activePlanId);
  const turn = plan?.turns?.find((candidate) => candidate.id === runtime.failedTurnId);
  if (!turn || !activeRunId()) return;
  $("#recoveryTurnId").value = turn.id;
  $("#recoveryDetails").innerHTML = [
    ["模型", turn.providerLabel || providerById(turn.providerId).label],
    ["阶段", turn.role === "closure" || turn.role === "host_summary" ? "自动收束" : turn.round ? `第 ${turn.round} 轮` : "当前回合"],
    ["原因", runtime.error?.message || turn.error?.message || "执行中断"],
    ["错误码", runtime.error?.code || turn.error?.code || "PROVIDER_EXECUTION_FAILED"],
  ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value)}</p></div>`).join("");
  if (!dialog.open) dialog.showModal();
}

async function resolvePermission(decision) {
  const requestId = $("#permissionRequestId").value;
  if (!requestId) return;
  await api(`/api/permissions/${encodeURIComponent(requestId)}/${decision}`, { method: "POST", body: "{}" });
  state.permission = null;
  $("#permissionDialog").close();
  showToast(decision === "reject" ? "已拒绝外部写入" : "授权已记录，任务将自动继续");
  scheduleRefresh();
}

async function runAction(action, payload = {}) {
  const runId = activeRunId();
  if (!state.session || !runId) return null;
  const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/runs/${encodeURIComponent(runId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.activeRun = result.run || state.activeRun;
  if (result.session) state.session = result.session;
  renderAll();
  return result;
}

async function resolveRunRecovery(action) {
  const turnId = $("#recoveryTurnId").value;
  if (!turnId) return;
  const content = action === "manual" ? $("#commandInput").value.trim() : "";
  if (action === "manual" && !content) {
    showToast("请先粘贴模型的真实回复", { error: true });
    return;
  }
  try {
    await runAction(action, { turnId, ...(action === "manual" ? { content } : {}) });
    $("#recoveryDialog").close();
    showToast(action === "retry" ? "已重新执行本回合" : action === "skip" ? "已跳过本回合" : "已采用手动回复");
    scheduleRefresh();
  } catch (error) {
    showToast(`恢复操作失败：${error.message}`, { error: true });
  }
}

$("#workspaceButton").addEventListener("click", () => {
  renderRecentWorkspaces();
  $("#workspaceInput").value = state.workspaceRegistry.selected?.root || "";
  $("#workspaceError").textContent = "";
  $("#workspaceDialog").showModal();
});

$("#workspaceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = $("#workspaceInput").value.trim();
  if (!target) return;
  try {
    const result = await api("/api/workspaces/select", { method: "POST", body: JSON.stringify({ path: target }) });
    state.workspaceRegistry.selected = result.workspace;
    state.sessions = result.sessions || [];
    $("#workspaceDialog").close();
    showToast(`工作区已连接：${result.workspace.name}`);
    await refreshRuntime({ preserveSession: false });
  } catch (error) {
    $("#workspaceError").textContent = `无法连接：${error.message}`;
  }
});

$("#recentWorkspaces").addEventListener("click", (event) => {
  const button = event.target.closest("[data-workspace-path]");
  if (button) $("#workspaceInput").value = button.dataset.workspacePath;
});

$("#newSessionButton").addEventListener("click", () => {
  renderNewSessionProviders();
  $("#newSessionDialog").showModal();
});

$("#newSessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const participants = $$('input[name="newProvider"]:checked').map((input) => input.value);
  if (!participants.length) return showToast("至少选择一个模型席位", { error: true });
  try {
    const result = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ participants, settings: currentSettings(), openThreads: true }),
    });
    state.session = result.session;
    state.tokens = [{ id: "all", label: "全体", kind: "all" }];
    $("#newSessionDialog").close();
    await refreshRuntime({ preserveSession: true });
    await loadSession(result.session.id);
    showToast("新圆桌已创建，模型线程正在就绪");
  } catch (error) {
    showToast(`创建失败：${error.message}`, { error: true });
  }
});

$("#sessionSelectTop").addEventListener("change", async (event) => {
  if (event.target.value) await loadSession(event.target.value);
});

$("#renameSessionButton").addEventListener("click", async () => {
  if (!state.session) return;
  const title = window.prompt("圆桌名称", state.session.title);
  if (!title?.trim() || title.trim() === state.session.title) return;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/rename`, { method: "POST", body: JSON.stringify({ title: title.trim() }) });
    state.session = result.session;
    await refreshRuntime();
  } catch (error) {
    showToast(`重命名失败：${error.message}`, { error: true });
  }
});

$("#addParticipantButton").addEventListener("click", () => {
  if (!renderParticipantChoices()) return showToast("当前可用模型均已入席");
  $("#participantDialog").showModal();
});

$("#participantForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session) return;
  const providerId = $("#participantProvider").value;
  const joinPolicy = $('input[name="joinPolicy"]:checked').value;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/participants`, { method: "POST", body: JSON.stringify({ providerId, joinPolicy }) });
    state.session = result.session;
    $("#participantDialog").close();
    renderAll();
    showToast(`${providerById(providerId).label} 将从下一轮开始参与`);
  } catch (error) {
    showToast(`入席失败：${error.message}`, { error: true });
  }
});

$("#participantList").addEventListener("click", async (event) => {
  const row = event.target.closest(".participant-row");
  if (!row || !state.session) return;
  if (event.target.closest(".participant-menu")) {
    row.classList.toggle("is-open");
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  const providerId = row.dataset.providerId;
  if (action === "remove") {
    if (!window.confirm(`让 ${providerById(providerId).label} 离席？其既有公共记录仍会保留。`)) return;
    try {
      const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/participants-remove`, { method: "POST", body: JSON.stringify({ providerId }) });
      state.session = result.session;
      renderAll();
    } catch (error) { showToast(`离席失败：${error.message}`, { error: true }); }
  }
  if (action === "handoff") {
    try {
      const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/handoffs`, { method: "POST", body: JSON.stringify({ providerId }) });
      $("#handoffId").value = result.handoff.id;
      $("#handoffPreview").textContent = JSON.stringify(result.handoff.packet, null, 2);
      $("#handoffDialog").showModal();
    } catch (error) { showToast(`交接预览失败：${error.message}`, { error: true }); }
  }
});

$("#handoffForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session) return;
  const handoffId = $("#handoffId").value;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/handoffs/${encodeURIComponent(handoffId)}/confirm`, { method: "POST", body: "{}" });
    state.session = result.session;
    $("#handoffDialog").close();
    renderAll();
    showToast("交接完成，席位已原子切换到新线程");
  } catch (error) {
    showToast(`交接失败，旧线程仍保留：${error.message}`, { error: true, timeout: 7000 });
  }
});

$("#mentionTokens").addEventListener("click", (event) => {
  const token = event.target.closest(".mention-token");
  if (!token || !event.target.closest("button")) return;
  state.tokens = removeToken(state.tokens, token.dataset.tokenId);
  renderComposerTokens();
  renderSendPreview();
});

$("#commandInput").addEventListener("compositionstart", () => { state.composing = true; });
$("#commandInput").addEventListener("compositionend", () => { state.composing = false; updateSuggestions(); });
$("#commandInput").addEventListener("input", updateSuggestions);
$("#commandInput").addEventListener("click", updateSuggestions);
$("#commandInput").addEventListener("keydown", (event) => {
  const count = state.suggestions.suggestions.length;
  if (count && event.key === "ArrowDown") {
    event.preventDefault();
    state.suggestions.activeIndex = (state.suggestions.activeIndex + 1) % count;
    return renderSuggestions();
  }
  if (count && event.key === "ArrowUp") {
    event.preventDefault();
    state.suggestions.activeIndex = (state.suggestions.activeIndex - 1 + count) % count;
    return renderSuggestions();
  }
  if (count && ["Tab", "Enter"].includes(event.key)) {
    event.preventDefault();
    return chooseSuggestion();
  }
  if (count && event.key === " " && $("#spaceAcceptMention").checked && !state.composing) {
    event.preventDefault();
    return chooseSuggestion();
  }
  if (event.key === "Escape") {
    state.suggestions = { range: null, suggestions: [], activeIndex: 0 };
    renderSuggestions();
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !count) {
    event.preventDefault();
    $("#commandForm").requestSubmit();
  }
});

$("#mentionSuggestions").addEventListener("click", (event) => {
  const item = event.target.closest("[data-suggestion-index]");
  if (item) chooseSuggestion(Number(item.dataset.suggestionIndex));
});

$("#commandForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session) return $("#newSessionButton").click();
  if (activeRunId()) return showToast("当前圆桌仍在执行，可切换到其他圆桌继续工作", { error: true });
  const input = $("#commandInput");
  const text = input.value.trim();
  const preview = composerPreview();
  if (!preview.valid) return showToast("请输入指令并确认至少一个发言标签", { error: true });
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/commands`, {
      method: "POST",
      body: JSON.stringify({
        text,
        targets: preview.targets,
        mentionTokens: state.tokens,
        references: preview.references,
        conversationMode: state.conversationMode,
        rounds: preview.rounds,
        settings: currentSettings(),
      }),
    });
    state.session = result.session;
    state.activeRun = result.run || null;
    input.value = "";
    state.suggestions = { range: null, suggestions: [], activeIndex: 0 };
    renderAll();
    showToast(result.run ? "指令已进入后台执行" : "本轮已完成");
  } catch (error) {
    showToast(`调度失败：${error.message}`, { error: true });
  }
});

for (const input of $$('input[name="conversationMode"]')) {
  input.addEventListener("change", () => {
    state.conversationMode = input.value;
    renderSendPreview();
  });
}
$("#roundDown").addEventListener("click", () => { state.rounds = Math.max(1, state.rounds - 1); renderSendPreview(); });
$("#roundUp").addEventListener("click", () => { state.rounds = Math.min(10, state.rounds + 1); renderSendPreview(); });

$("#pauseButton").addEventListener("click", async () => {
  if (!activeRunId()) return showToast("当前圆桌没有运行中的任务");
  const currentStatus = state.activeRun?.status || state.session?.runtime?.status;
  if (currentStatus === "waiting_recovery") {
    refreshRecoveryDialog();
    return;
  }
  const paused = currentStatus === "paused";
  try { await runAction(paused ? "resume" : "pause"); showToast(paused ? "圆桌已继续" : "将在当前网页回合结束后暂停"); }
  catch (error) { showToast(`暂停操作失败：${error.message}`, { error: true }); }
});

$("#stopButton").addEventListener("click", async () => {
  if (!activeRunId()) return showToast("当前圆桌没有运行中的任务");
  if (!window.confirm("终止当前圆桌本轮执行？已完成的回复和事务不会重复。")) return;
  try { await runAction("cancel", { reason: "用户终止当前圆桌" }); showToast("本轮已终止"); }
  catch (error) { showToast(`终止失败：${error.message}`, { error: true }); }
});

$("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
$("#runtimeButton").addEventListener("click", () => { renderRuntimeDetails(); $("#settingsDialog").showModal(); });

$$('.tab-button').forEach((button) => button.addEventListener("click", () => {
  $$(".tab-button").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === button.dataset.tab));
}));

$("#fileView").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-rollback-id]");
  if (!button || !state.session) return;
  try {
    if (button.dataset.rollbackType === "transaction") {
      await api(`/api/sessions/${encodeURIComponent(state.session.id)}/transactions/${encodeURIComponent(button.dataset.rollbackId)}/rollback`, { method: "POST", body: "{}" });
    } else {
      await api(`/api/sessions/${encodeURIComponent(state.session.id)}/artifacts/${encodeURIComponent(button.dataset.rollbackId)}/rollback`, { method: "POST", body: "{}" });
    }
    await loadSession(state.session.id, { reconnect: false });
    showToast("回撤已完成");
  } catch (error) { showToast(`回撤失败：${error.message}`, { error: true }); }
});

$("#roundtableSeats").addEventListener("pointerdown", (event) => {
  const nodeElement = event.target.closest(".seat-node");
  if (!nodeElement || !state.session) return;
  const id = nodeElement.dataset.providerId;
  const node = state.layoutNodes.find((candidate) => candidate.id === id);
  if (!node) return;
  state.dragging = { id, pointerId: event.pointerId };
  nodeElement.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

window.addEventListener("pointermove", (event) => {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
  const stage = $(".roundtable-stage");
  const rect = stage.getBoundingClientRect();
  const node = state.layoutNodes.find((candidate) => candidate.id === state.dragging.id);
  if (!node) return;
  node.x = Math.max(0.06, Math.min(0.94, (event.clientX - rect.left) / rect.width));
  node.y = Math.max(0.07, Math.min(0.91, (event.clientY - rect.top) / rect.height));
  node.vx = 0;
  node.vy = 0;
  applyNodePositions();
});

window.addEventListener("pointerup", async (event) => {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId || !state.session) return;
  const draggedId = state.dragging.id;
  state.dragging = null;
  const snapped = findSnappedHost(state.layoutNodes);
  if (snapped === draggedId) {
    const node = state.layoutNodes.find((candidate) => candidate.id === snapped);
    node.x = HOST_POINT.x;
    node.y = HOST_POINT.y;
  }
  const layout = Object.fromEntries(state.layoutNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.session.id)}/participant-layout`, {
      method: "POST",
      body: JSON.stringify({ order: state.session.participants.map((participant) => participant.id), layout, hostId: snapped }),
    });
    state.session = result.session;
    renderAll();
  } catch (error) { showToast(`席位保存失败：${error.message}`, { error: true }); }
});

$("#rejectPermissionButton").addEventListener("click", () => void resolvePermission("reject"));
$("#allowOnceButton").addEventListener("click", () => void resolvePermission("allow-once"));
$("#allowTaskButton").addEventListener("click", () => void resolvePermission("allow-task"));
$("#skipRecoveryButton").addEventListener("click", () => void resolveRunRecovery("skip"));
$("#retryRecoveryButton").addEventListener("click", () => void resolveRunRecovery("retry"));

for (const button of $$(".dialog-close")) {
  button.addEventListener("click", () => button.closest("dialog")?.close());
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshRuntime().catch(() => {});
});

window.addEventListener("beforeunload", () => state.eventSource?.close());

async function initialize() {
  state.animationFrame = requestAnimationFrame(animateRoundtable);
  try {
    await refreshRuntime({ preserveSession: false });
  } catch (error) {
    renderAll();
    showToast(`本地圆桌服务不可用：${error.message}`, { error: true, timeout: 9000 });
  }
  setInterval(() => void refreshRuntime().catch(() => {}), 10000);
}

void initialize();

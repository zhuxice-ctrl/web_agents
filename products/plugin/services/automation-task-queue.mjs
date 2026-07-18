import { randomUUID } from "node:crypto";

function queueError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createAutomationTaskQueue({
  capacity = 128,
  taskTimeoutMs = 5 * 60_000,
  retentionMs = 10 * 60_000,
  idFactory = () => randomUUID(),
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw queueError("INVALID_QUEUE_CAPACITY");
  const tasks = new Map();
  const tasksByClientRequestId = new Map();
  const pendingIds = [];
  const dispatchedIds = new Set();
  const waiters = new Set();
  let closed = false;

  function finish(task, result, completedAt = now()) {
    dispatchedIds.delete(task.taskId);
    task.completedAt = completedAt;
    task.expiresAt = completedAt + retentionMs;
    if (result?.ok) {
      task.state = "done";
      task.result = result;
      delete task.error;
    } else {
      task.state = "error";
      task.error = result?.error || { code: "AUTOMATION_TASK_FAILED" };
      delete task.result;
    }
    return task;
  }

  function sweep() {
    const current = now();
    for (const task of tasks.values()) {
      if (task.state === "pending" && current > task.deadlineAt) {
        finish(task, { ok: false, error: { code: "AUTOMATION_TASK_TIMEOUT" } }, current);
      } else if (task.state !== "pending" && current > task.expiresAt) {
        tasks.delete(task.taskId);
        if (tasksByClientRequestId.get(task.clientRequestId) === task.taskId) {
          tasksByClientRequestId.delete(task.clientRequestId);
        }
      }
    }
  }

  function nextPendingTask() {
    sweep();
    while (pendingIds.length) {
      const task = tasks.get(pendingIds.shift());
      if (!task || task.state !== "pending" || dispatchedIds.has(task.taskId)) continue;
      dispatchedIds.add(task.taskId);
      return task;
    }
    return null;
  }

  function dispatchToWaiter(task) {
    const waiter = waiters.values().next().value;
    if (!waiter) return false;
    waiters.delete(waiter);
    clearTimeout(waiter.timeout);
    dispatchedIds.add(task.taskId);
    waiter.resolve(task);
    return true;
  }

  const sweepTimer = setInterval(sweep, Math.max(250, Math.min(taskTimeoutMs, retentionMs) / 2));
  sweepTimer.unref?.();

  return {
    submit(input) {
      if (closed) throw queueError("AUTOMATION_QUEUE_CLOSED");
      sweep();
      const clientRequestId = String(input?.clientRequestId || "").trim();
      const existingId = tasksByClientRequestId.get(clientRequestId);
      const existing = existingId ? tasks.get(existingId) : null;
      if (existing) return existing;
      const active = [...tasks.values()].filter((task) => task.state === "pending").length;
      if (active >= capacity) throw queueError("AUTOMATION_QUEUE_FULL");

      const submittedAt = now();
      const task = {
        ...structuredClone(input),
        taskId: String(idFactory()),
        clientRequestId,
        state: "pending",
        submittedAt,
        deadlineAt: submittedAt + taskTimeoutMs,
      };
      tasks.set(task.taskId, task);
      tasksByClientRequestId.set(clientRequestId, task.taskId);
      if (!dispatchToWaiter(task)) pendingIds.push(task.taskId);
      return task;
    },

    take({ waitMs = 0 } = {}) {
      if (closed) return Promise.resolve(null);
      const task = nextPendingTask();
      if (task || waitMs <= 0) return Promise.resolve(task);
      return new Promise((resolve) => {
        const waiter = { resolve, timeout: null };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          resolve(null);
        }, waitMs);
        waiter.timeout.unref?.();
        waiters.add(waiter);
      });
    },

    complete(taskId, result) {
      sweep();
      const task = tasks.get(String(taskId || ""));
      if (!task) throw queueError("AUTOMATION_TASK_NOT_FOUND");
      if (task.state !== "pending") throw queueError("AUTOMATION_TASK_NOT_PENDING");
      return finish(task, result);
    },

    get(taskId) {
      sweep();
      return tasks.get(String(taskId || "")) || null;
    },

    sweep,

    snapshot() {
      sweep();
      return {
        pending: [...tasks.values()].filter((task) => task.state === "pending").length,
        waitingConsumers: waiters.size,
        total: tasks.size,
      };
    },

    close() {
      if (closed) return;
      closed = true;
      clearInterval(sweepTimer);
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(null);
      }
      waiters.clear();
    },
  };
}

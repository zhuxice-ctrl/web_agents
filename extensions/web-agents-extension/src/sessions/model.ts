import { DEFAULT_PARTICIPANTS } from "../shared/defaults";
import type { TaskSession } from "../shared/types";

export function createTaskSession(prompt = ""): TaskSession {
  return {
    id: `task-${Date.now()}`,
    title: prompt.trim().slice(0, 36) || "未命名任务",
    prompt,
    createdAt: new Date().toISOString(),
    participants: DEFAULT_PARTICIPANTS.map((participant) => ({ ...participant }))
  };
}

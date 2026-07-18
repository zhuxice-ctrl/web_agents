import { DEFAULT_PARTICIPANTS } from "../shared/defaults";
import type { TaskSession } from "../shared/types";

let sessionSequence = 0;

export function createTaskSession(prompt = "", workspaceRoot = ""): TaskSession {
  sessionSequence += 1;
  const id = `task-${Date.now()}-${sessionSequence}`;
  return {
    id,
    mcpSessionId: `mcp-${id}`,
    workspaceRoot,
    title: prompt.trim().slice(0, 36) || "未命名任务",
    prompt,
    createdAt: new Date().toISOString(),
    participants: DEFAULT_PARTICIPANTS.map((participant) => ({ ...participant }))
  };
}

export function updateTaskSessionWorkspace(session: TaskSession, workspaceRoot: string): TaskSession {
  return { ...session, workspaceRoot: workspaceRoot.trim() };
}

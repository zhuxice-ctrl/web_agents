import { describe, expect, it } from "vitest";

import { createTaskSession, updateTaskSessionWorkspace } from "./model";

describe("task sessions", () => {
  it("creates independent MCP identities and preserves each workspace", () => {
    const first = createTaskSession("one", "F:\\project-a");
    const second = createTaskSession("two", "F:\\project-b");

    expect(first.id).not.toBe(second.id);
    expect(first.workspaceRoot).toBe("F:\\project-a");
    expect(first.mcpSessionId).toContain(first.id);
    expect(second.workspaceRoot).toBe("F:\\project-b");
    expect(second.mcpSessionId).toContain(second.id);
  });

  it("updates a session workspace without changing its identity", () => {
    const session = createTaskSession("one", "F:\\project-a");
    const updated = updateTaskSessionWorkspace(session, " F:\\project-b ");

    expect(updated).not.toBe(session);
    expect(updated.id).toBe(session.id);
    expect(updated.mcpSessionId).toBe(session.mcpSessionId);
    expect(updated.workspaceRoot).toBe("F:\\project-b");
  });
});

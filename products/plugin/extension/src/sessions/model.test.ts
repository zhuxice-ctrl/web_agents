import { describe, expect, it } from "vitest";

import { createTaskSession } from "./model";

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
});

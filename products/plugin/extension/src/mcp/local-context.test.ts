import { describe, expect, it } from "vitest";
import { buildPromptWithLocalContext, extractLocalPaths } from "./local-context";
import type { LocalContextAttachment } from "../shared/types";

describe("local context task preparation", () => {
  it("extracts an unquoted Windows path from a Chinese task", () => {
    expect(extractLocalPaths("给我阅读一下F:\\web_agents这个路径上都有些什么程序")).toEqual(["F:\\web_agents"]);
  });

  it("extracts a quoted Windows path with spaces", () => {
    expect(extractLocalPaths("读取 \"F:\\My Projects\\web agents\" 下面的文件")).toEqual([
      "F:\\My Projects\\web agents"
    ]);
  });

  it("builds a prompt that tells the web model to use local MCP results", () => {
    const attachments: LocalContextAttachment[] = [
      {
        path: "F:\\web_agents",
        kind: "directory",
        toolName: "list_directory",
        content: "[DIR] extensions\n[FILE] README.md",
        truncated: false
      }
    ];

    const prompt = buildPromptWithLocalContext("看看这个目录", attachments);

    expect(prompt).toContain("不要再说你无法访问本地路径");
    expect(prompt).toContain("F:\\web_agents");
    expect(prompt).toContain("[DIR] extensions");
  });
});

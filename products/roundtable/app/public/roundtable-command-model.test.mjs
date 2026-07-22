import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoundtableCommand } from "./roundtable-command-model.mjs";

test("active plan command wins over the latest ledger command", () => {
  const session = {
    plans: [{ status: "running", commandText: "当前正在执行" }],
    events: [{ type: "command", content: "最近用户命令" }],
  };
  assert.equal(resolveRoundtableCommand(session), "当前正在执行");
});

test("idle session shows the latest user command", () => {
  const session = {
    objective: "旧目标",
    plans: [{ status: "completed", commandText: "旧计划" }],
    events: [
      { type: "command", content: "第一条" },
      { type: "reply", content: "回复" },
      { type: "command", content: "最近一条" },
    ],
  };
  assert.equal(resolveRoundtableCommand(session), "最近一条");
});

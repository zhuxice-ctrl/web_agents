import { describe, expect, it } from "vitest";

import { createSessionRunner } from "./session-runner";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("session runner", () => {
  it("runs different sessions concurrently without a global limit", async () => {
    const runner = createSessionRunner();
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    const operation = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    };

    const running = Promise.all([
      runner.run("session-a", operation),
      runner.run("session-b", operation)
    ]);
    await Promise.resolve();
    expect(maxActive).toBe(2);
    gate.resolve();
    await running;
  });

  it("serializes DOM mutations for the same session", async () => {
    const runner = createSessionRunner();
    const gate = deferred();
    const events: string[] = [];

    const first = runner.run("session-a", async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
    });
    const second = runner.run("session-a", async () => {
      events.push("second:start");
      events.push("second:end");
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { atomicWriteFile, atomicWriteJson } from "../src/atomic-file.mjs";

function createFaultInjectingFileSystem({ failures, onRename } = {}) {
  let renameCalls = 0;
  const removedPaths = [];
  return {
    fileSystem: {
      mkdir: (...args) => fs.mkdir(...args),
      writeFile: (...args) => fs.writeFile(...args),
      async rename(source, destination) {
        renameCalls += 1;
        await onRename?.({ call: renameCalls, source, destination });
        const code = failures?.get(renameCalls);
        if (code) throw Object.assign(new Error(`Injected rename failure ${code}`), { code });
        return fs.rename(source, destination);
      },
      async rm(target, options) {
        removedPaths.push(target);
        return fs.rm(target, options);
      },
    },
    get renameCalls() {
      return renameCalls;
    },
    removedPaths,
  };
}

test("atomic write installs a new file directly", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-atomic-new-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.txt");

  await atomicWriteFile(target, "created", { idFactory: () => "new" });

  assert.equal(await fs.readFile(target, "utf8"), "created");
  assert.deepEqual((await fs.readdir(directory)).filter((name) => /\.(?:tmp|recovery)$/.test(name)), []);
});

test("atomic write keeps a recoverable original during Windows replacement", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-atomic-success-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");
  await fs.writeFile(target, "original", "utf8");
  let recoveryPath;
  let recoverableContent;
  const injected = createFaultInjectingFileSystem({
    failures: new Map([[1, "EEXIST"]]),
    async onRename({ call, destination }) {
      if (call === 2) recoveryPath = destination;
      if (call === 3) recoverableContent = await fs.readFile(recoveryPath, "utf8");
    },
  });

  await atomicWriteFile(target, "replacement", {
    fileSystem: injected.fileSystem,
    idFactory: () => "success",
  });

  assert.equal(recoverableContent, "original");
  assert.equal(await fs.readFile(target, "utf8"), "replacement");
  assert.equal(injected.removedPaths.includes(target), false);
  assert.equal(injected.renameCalls, 3);
  assert.deepEqual((await fs.readdir(directory)).filter((name) => /\.(?:tmp|recovery)$/.test(name)), []);
});

test("atomic write restores the original when installing the replacement fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-atomic-restore-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");
  await fs.writeFile(target, "original", "utf8");
  const injected = createFaultInjectingFileSystem({
    failures: new Map([
      [1, "EEXIST"],
      [3, "EPERM"],
    ]),
  });

  await assert.rejects(
    () => atomicWriteFile(target, "replacement", {
      fileSystem: injected.fileSystem,
      idFactory: () => "restore",
    }),
    /Injected rename failure EPERM/
  );

  assert.equal(await fs.readFile(target, "utf8"), "original");
  assert.equal(injected.removedPaths.includes(target), false);
  assert.equal(injected.renameCalls, 4);
  assert.deepEqual((await fs.readdir(directory)).filter((name) => /\.(?:tmp|recovery)$/.test(name)), []);
});

test("atomic JSON writes formatted data with a trailing newline", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-core-atomic-json-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");

  await atomicWriteJson(target, { status: "ready" }, { idFactory: () => "json" });

  assert.equal(await fs.readFile(target, "utf8"), '{\n  "status": "ready"\n}\n');
});

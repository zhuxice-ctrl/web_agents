import assert from "node:assert/strict";
import test from "node:test";

import {
  createToolRegistry,
  defaultToolRegistry,
  TOOL_METADATA_FIELDS,
  ToolRegistry,
  ToolRegistryError,
} from "../src/tool-registry.mjs";

test("default filesystem tools have every explicit permission metadata field", () => {
  const descriptors = defaultToolRegistry.list();
  assert.ok(descriptors.length >= 13);
  for (const descriptor of descriptors) {
    for (const field of TOOL_METADATA_FIELDS) {
      assert.equal(typeof descriptor.metadata[field], "boolean", `${descriptor.name}.${field}`);
    }
    assert.notEqual(descriptor.metadata.readOnly, descriptor.metadata.mutating, descriptor.name);
  }
  assert.equal(defaultToolRegistry.get("write_file").mutating, true);
  assert.equal(defaultToolRegistry.get("read_text_file").readOnly, true);
});

test("unknown and incomplete tool definitions fail closed", () => {
  const registry = createToolRegistry({});
  assert.throws(
    () => registry.get("not_registered"),
    (error) => error instanceof ToolRegistryError && error.code === "UNKNOWN_TOOL"
  );
  assert.deepEqual(registry.resolve("not_registered").allowed, false);

  assert.throws(
    () => new ToolRegistry({
      unsafe: {
        readOnly: false,
        mutating: true,
        destructive: true,
      },
    }),
    (error) => error instanceof ToolRegistryError && error.code === "TOOL_METADATA_INCOMPLETE"
  );
  assert.throws(
    () => new ToolRegistry({
      contradictory: {
        readOnly: true,
        mutating: true,
        destructive: false,
        reversible: true,
        openWorld: false,
        idempotent: true,
      },
    }),
    (error) => error instanceof ToolRegistryError && error.code === "TOOL_METADATA_CONFLICT"
  );
});
test("registry extracts declared path arguments without guessing from tool names", () => {
  assert.deepEqual(
    defaultToolRegistry.extractPathSpecs("move_file", {
      source: "C:\\work\\before.txt",
      destination: "C:\\work\\after.txt",
      unrelated: "C:\\ignored.txt",
    }),
    [
      { path: "C:\\work\\before.txt", subtree: false, role: "source", argument: "source" },
      { path: "C:\\work\\after.txt", subtree: false, role: "destination", argument: "destination" },
    ]
  );
  assert.deepEqual(
    defaultToolRegistry.extractPaths("read_multiple_files", { paths: ["a.txt", "b.txt"] }),
    ["a.txt", "b.txt"]
  );
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("local core has no product runtime dependency", async () => {
  for (const name of await fs.readdir(root)) {
    if (!name.endsWith(".mjs")) continue;
    const source = await fs.readFile(path.join(root, name), "utf8");
    assert.doesNotMatch(
      source,
      /products[\\/]|apps[\\/]|extensions[\\/]|chrome\.|document\.|localhost|127\.0\.0\.1|\b(?:3006|3017|3020|8931|9223)\b/i,
      name
    );
    assert.doesNotMatch(source, /node:http|createServer\s*\(/, name);
  }
});

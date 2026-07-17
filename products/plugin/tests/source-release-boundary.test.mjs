import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(testDir, "../../../extensions/web-agents-extension");

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ["dist", "node_modules"].includes(entry.name)) continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(item));
    else if (/\.(?:ts|tsx|js|json|css)$/.test(entry.name)) output.push(item);
  }
  return output;
}

test("source normal plugin contains no roundtable product code", async () => {
  for (const file of await sourceFiles(extensionDir)) {
    const relative = path.relative(extensionDir, file).replaceAll("\\", "/");
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(`${relative}\n${source}`, /roundtable/i, relative);
  }
});

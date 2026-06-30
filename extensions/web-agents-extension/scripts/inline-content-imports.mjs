import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDir, "..");
const contentPath = resolve(extensionRoot, "dist/content.js");

function parseImportSpecifiers(value) {
  return value.split(",").map((item) => {
    const parts = item.trim().split(/\s+as\s+/);
    const exportedName = parts[0]?.trim();
    const localName = (parts[1] ?? parts[0])?.trim();

    if (!exportedName || !localName) {
      throw new Error(`Unable to parse import/export specifier: ${item}`);
    }

    return { exportedName, localName };
  });
}

function parseExportSpecifiers(value) {
  return value.split(",").map((item) => {
    const parts = item.trim().split(/\s+as\s+/);
    const localName = parts[0]?.trim();
    const exportedName = (parts[1] ?? parts[0])?.trim();

    if (!exportedName || !localName) {
      throw new Error(`Unable to parse export specifier: ${item}`);
    }

    return { exportedName, localName };
  });
}

async function inlineFirstImport() {
  const contentCode = await readFile(contentPath, "utf8");
  const importMatch = contentCode.match(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];/);

  if (!importMatch) {
    return;
  }

  const importedSpecifiers = parseImportSpecifiers(importMatch[1]);
  const importedPath = resolve(dirname(contentPath), importMatch[2]);
  const importedCode = await readFile(importedPath, "utf8");
  const exportMatch = importedCode.match(/export\s*\{([^}]+)\};?\s*(?:\/\/# sourceMappingURL=.*)?\s*$/s);

  if (!exportMatch || typeof exportMatch.index !== "number") {
    throw new Error(`Unable to find export map in ${importedPath}`);
  }

  const exportSpecifiers = parseExportSpecifiers(exportMatch[1]);
  const exportEntries = exportSpecifiers.map(
    ({ exportedName, localName }) => `${JSON.stringify(exportedName)}:${localName}`
  );
  const exportMap = new Map(exportSpecifiers.map(({ exportedName, localName }) => [exportedName, localName]));
  const aliasLines = importedSpecifiers.map(({ exportedName, localName }) => {
    if (!exportMap.has(exportedName)) {
      throw new Error(`Imported name ${exportedName} is not exported by ${importedPath}`);
    }

    return `const ${localName}=__contentScriptImports[${JSON.stringify(exportedName)}];`;
  });

  const importedBody = importedCode.slice(0, exportMatch.index).trimEnd();
  const contentBody = contentCode.slice(importMatch[0].length).trimStart();
  const inlinedCode = [
    "const __contentScriptImports=(()=>{",
    importedBody,
    `return {${exportEntries.join(",")}};`,
    "})();",
    ...aliasLines,
    contentBody
  ].join("\n");

  await writeFile(contentPath, inlinedCode, "utf8");
}

await inlineFirstImport();

const finalContentCode = await readFile(contentPath, "utf8");
if (/^\s*import\s/m.test(finalContentCode) || /\bfrom\s*["']/.test(finalContentCode)) {
  throw new Error("dist/content.js still contains static ESM imports, which Chrome manifest content scripts cannot load.");
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "data"]);
const STATIC_IMPORT = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

async function walkFiles(root) {
  const output = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(item));
    else output.push(item);
  }
  return output;
}

async function scanImports(root, inspect) {
  for (const file of await walkFiles(root)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(STATIC_IMPORT)) inspect(match[1] || match[2], file);
  }
}

function importsProduct(specifier, file, productRoot, packagePattern) {
  if (packagePattern.test(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  const resolvedProduct = path.resolve(productRoot);
  const resolvedImport = path.resolve(path.dirname(file), specifier);
  return resolvedImport === resolvedProduct || resolvedImport.startsWith(`${resolvedProduct}${path.sep}`);
}

async function scanCoreForProductTerms(root, violations) {
  const forbidden = /products[\\/]|apps[\\/]|extensions[\\/]|node:http|chrome\.|document\.|localhost|127\.0\.0\.1|\b(?:3006|3017|3020|8931|9223)\b/i;
  for (const file of await walkFiles(root)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    const source = await fs.readFile(file, "utf8");
    if (forbidden.test(source)) violations.push({ file, rule: "product-neutral-core" });
  }
}

async function checkNormalPlugin(root, violations) {
  for (const file of await walkFiles(root)) {
    if (path.basename(file) !== "manifest.json") continue;
    const source = await fs.readFile(file, "utf8");
    if (/roundtable/i.test(source)) {
      violations.push({ file, rule: "normal-plugin-roundtable-manifest" });
    }
  }
  for (const directory of ["extension"]) {
    for (const file of await walkFiles(path.join(root, directory))) {
      if (!/\.(?:js|mjs|ts|tsx|json|css)$/.test(file)) continue;
      const source = await fs.readFile(file, "utf8");
      if (/roundtable/i.test(source)) violations.push({ file, rule: "normal-plugin-roundtable-code" });
    }
  }
}

export async function checkProductBoundaries({ repoRoot }) {
  const resolvedRoot = path.resolve(repoRoot);
  const violations = [];
  const pluginRoot = path.join(resolvedRoot, "products/plugin");
  const roundtableRoot = path.join(resolvedRoot, "products/roundtable");
  await scanImports(pluginRoot, (specifier, file) => {
    if (importsProduct(specifier, file, roundtableRoot, /products[\\/]roundtable|@web-agents[\\/]roundtable/i)) {
      violations.push({ file, rule: "plugin-imports-roundtable", specifier });
    }
  });
  await scanImports(roundtableRoot, (specifier, file) => {
    if (importsProduct(specifier, file, pluginRoot, /products[\\/]plugin|@web-agents[\\/]plugin/i)) {
      violations.push({ file, rule: "roundtable-imports-plugin", specifier });
    }
  });
  await scanCoreForProductTerms(path.join(resolvedRoot, "packages/local-core/src"), violations);
  await checkNormalPlugin(path.join(resolvedRoot, "products/plugin"), violations);
  const roundtablePackage = JSON.parse(
    await fs.readFile(path.join(resolvedRoot, "products/roundtable/package.json"), "utf8")
  );
  if (/test:compat/.test(roundtablePackage.scripts?.test || "")) {
    violations.push({ file: "products/roundtable/package.json", rule: "compat-in-default-test" });
  }
  if (violations.length) {
    const error = new Error("PRODUCT_BOUNDARY_VIOLATION");
    error.violations = violations;
    throw error;
  }
  return { ok: true, violations: [] };
}

const currentFile = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] || "") === currentFile) {
  try {
    await checkProductBoundaries({ repoRoot: path.resolve(path.dirname(currentFile), "..") });
    console.log("Product boundaries: OK");
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, violations: error.violations || [] }, null, 2));
    process.exitCode = 1;
  }
}

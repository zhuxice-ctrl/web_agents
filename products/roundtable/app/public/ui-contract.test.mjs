import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("the approved roundtable layout has one task input and advanced settings stay in a drawer", async () => {
  const [html, app, css] = await Promise.all([
    fs.readFile(new URL("./index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("./app.js", import.meta.url), "utf8"),
    fs.readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);

  assert.equal((html.match(/<textarea\b/g) || []).length, 1);
  assert.match(html, /id="workspaceButton"/);
  assert.match(html, /id="sessionSelectTop"/);
  assert.match(html, /id="settingsDialog" class="settings-drawer"/);
  assert.match(html, /id="permissionDialog"/);
  assert.match(html, /id="recoveryDialog"/);
  assert.match(html, /id="handoffDialog"/);
  assert.match(html, /data-tab="context"/);
  assert.match(html, /id="contextUsage"/);
  assert.match(html, /id="compressionRevision"/);
  assert.match(html, /id="compressionCoverage"/);
  assert.match(html, /id="compressedContextView"/);
  assert.match(html, /id="recentRawContextView"/);
  assert.match(html, /id="compressionEditDialog"/);
  assert.equal((html.match(/data-task-input="true"/g) || []).length, 1);
  assert.doesNotMatch(html, /当前任务|数据根目录/);
  assert.match(app, /getComposerSuggestions/);
  assert.match(app, /findSnappedHost/);
  assert.match(app, /resolveRunRecovery/);
  assert.match(app, /previousSessionId !== state\.session\.id/);
  assert.doesNotMatch(app, /if \(!state\.tokens\.length\)/);
  assert.match(css, /node-to-node|\.seat-node/);
});

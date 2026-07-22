import test from "node:test";
import assert from "node:assert/strict";

import {
  decideReplyCommit,
  isContextEvent,
  isCommittedReplyEvent,
  normalizeReplyIdentity,
} from "./reply-lifecycle.mjs";

test("strict reply commit accepts natural assistant text and still rejects dangerous content", () => {
  const identity = normalizeReplyIdentity({
    providerId: "chatgpt",
    content: "自然讨论内容",
    capture: { identity: "dom-1", speaker: "assistant", messageId: "msg-1" },
  });
  assert.equal(identity.providerMessageId, "msg-1");
  assert.equal(identity.domIdentity, "dom-1");
  assert.deepEqual(
    decideReplyCommit({ strict: true, structureStatus: "invalid", quality: { flags: [] }, identity }),
    { status: "committed", reason: "validated" },
  );
  assert.deepEqual(
    decideReplyCommit({ strict: true, structureStatus: "invalid", quality: { flags: [{ code: "prompt_echo" }] }, identity }),
    { status: "rejected", reason: "PROMPT_ECHO" },
  );
});

test("context projection accepts only committed reply events", () => {
  const committed = { type: "reply", metadata: { commitStatus: "committed" } };
  const rejected = { type: "reply", metadata: { commitStatus: "rejected" } };
  assert.equal(isCommittedReplyEvent(committed), true);
  assert.equal(isCommittedReplyEvent(rejected), false);
  assert.equal(isContextEvent(committed), true);
  assert.equal(isContextEvent(rejected), false);
  assert.equal(isContextEvent({ type: "reply.raw_captured" }), false);
});

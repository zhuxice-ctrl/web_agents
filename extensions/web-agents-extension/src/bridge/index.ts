import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import {
  ROUND_TABLE_BRIDGE_SOURCE,
  isLocalBridgeRequestEnvelope,
  isRoundtableBridgeOrigin,
  redactBridgeError,
  sanitizeBridgeErrors
} from "./protocol";

const targetOrigin = window.location.origin;

function postToPage(payload: Record<string, unknown>): void {
  window.postMessage({
    source: ROUND_TABLE_BRIDGE_SOURCE,
    direction: "extension-to-page",
    ...payload
  }, targetOrigin);
}

if (isRoundtableBridgeOrigin(targetOrigin)) {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== targetOrigin || !isLocalBridgeRequestEnvelope(event.data)) {
      return;
    }

    const { requestId, request } = event.data;
    if (request.type === "bridge:ping") {
      postToPage({
        type: "bridge:response",
        requestId,
        response: {
          ok: true,
          type: "bridge:ping",
          data: { extensionVersion: chrome.runtime.getManifest().version }
        }
      });
      return;
    }
    void chrome.runtime.sendMessage(request as ExtensionRequest)
      .then((response: ExtensionResponse) => {
        postToPage({
          type: "bridge:response",
          requestId,
          response: sanitizeBridgeErrors(response)
        });
      })
      .catch((error: unknown) => {
        postToPage({
          type: "bridge:response",
          requestId,
          response: {
            ok: false,
            type: request.type,
            error: redactBridgeError(error instanceof Error ? error.message : error)
          }
        });
      });
  });

  postToPage({
    type: "bridge:ready",
    extensionVersion: chrome.runtime.getManifest().version
  });
}

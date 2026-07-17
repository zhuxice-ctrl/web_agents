(function initRoundtablePageBridge(root) {
  "use strict";

  const protocol = root.__webAgentRoundtableProtocol;
  const targetOrigin = root.location?.origin || "";
  const runtime = root.chrome?.runtime;

  if (
    !protocol?.isTrustedRoundtableOrigin(targetOrigin)
    || !runtime
    || typeof root.addEventListener !== "function"
    || typeof root.postMessage !== "function"
  ) {
    return;
  }

  function extensionVersion() {
    return String(runtime.getManifest?.().version || "");
  }

  function postToPage(payload) {
    root.postMessage({
      source: protocol.SOURCE,
      direction: "extension-to-page",
      ...payload,
    }, targetOrigin);
  }

  function postResponse(requestId, response) {
    postToPage({
      type: "bridge:response",
      requestId,
      response: protocol.sanitizeBridgeValue(response),
    });
  }

  root.addEventListener("message", (event) => {
    const envelope = event.data;
    if (event.source !== root || event.origin !== targetOrigin) return;
    if (
      !envelope
      || typeof envelope !== "object"
      || Array.isArray(envelope)
      || envelope.source !== protocol.SOURCE
      || envelope.direction !== "page-to-extension"
      || typeof envelope.requestId !== "string"
      || !envelope.requestId.trim()
      || envelope.requestId.length > 128
      || !envelope.request
      || typeof envelope.request !== "object"
      || Array.isArray(envelope.request)
    ) {
      return;
    }

    const { requestId } = envelope;
    if (envelope.request.type === "bridge:ping") {
      postResponse(requestId, {
        ok: true,
        type: "bridge:ping",
        data: {
          extensionVersion: extensionVersion(),
          bridgeRevision: protocol.BRIDGE_REVISION,
        },
      });
      return;
    }

    let request;
    try {
      request = protocol.validateRoundtableRequest(envelope.request);
    } catch (error) {
      postResponse(requestId, {
        ok: false,
        type: typeof envelope.request.type === "string" ? envelope.request.type : "unknown",
        error: String(error?.message || error),
      });
      return;
    }

    void Promise.resolve()
      .then(() => runtime.sendMessage(request))
      .then((response) => postResponse(requestId, response))
      .catch((error) => {
        postResponse(requestId, {
          ok: false,
          type: request.type,
          error: String(error?.message || error),
        });
      });
  });

  postToPage({
    type: "bridge:ready",
    extensionVersion: extensionVersion(),
    bridgeRevision: protocol.BRIDGE_REVISION,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

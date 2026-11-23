(() => {
  function sendToPage(type, payload) {
    window.postMessage({ type, payload }, location.origin);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === "SMARTRAIL_IRCTC_AUTO_OPEN") {
      chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_AUTO_OPEN" }).catch(() => {});
    }
    if (event.data?.type === "SMARTRAIL_IRCTC_AUTO_SEARCH") {
      chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_AUTO_SEARCH", payload: event.data.payload || {} })
        .then(result => sendToPage("SMARTRAIL_IRCTC_BRIDGE_STATUS", result?.ok ? "Opening IRCTC and starting automatic journey search…" : result?.error || "Could not start automatic IRCTC search."))
        .catch(() => sendToPage("SMARTRAIL_IRCTC_BRIDGE_STATUS", "Chrome bridge could not start the IRCTC search."));
    }
    if (event.data?.type === "SMARTRAIL_IRCTC_REQUEST") {
      chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_GET" })
        .then(payload => sendToPage("SMARTRAIL_IRCTC_RESPONSE", payload || { installed: true, snapshots: [] }))
        .catch(() => sendToPage("SMARTRAIL_IRCTC_RESPONSE", { installed: false, snapshots: [] }));
    }
    if (event.data?.type === "SMARTRAIL_IRCTC_CLEAR") {
      chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_CLEAR" })
        .then(() => sendToPage("SMARTRAIL_IRCTC_RESPONSE", { installed: true, snapshots: [] }))
        .catch(() => sendToPage("SMARTRAIL_IRCTC_RESPONSE", { installed: true, snapshots: [] }));
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "SMARTRAIL_IRCTC_UPDATE" && Array.isArray(message.snapshots)) {
      sendToPage("SMARTRAIL_IRCTC_UPDATE", { installed: true, snapshots: message.snapshots });
    }
    if (message?.type === "SMARTRAIL_IRCTC_BRIDGE_STATUS") {
      sendToPage("SMARTRAIL_IRCTC_BRIDGE_STATUS", message.status || "IRCTC bridge running");
    }
  });
})();

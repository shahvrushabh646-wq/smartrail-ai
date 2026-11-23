(() => {
  function sendToPage(type, payload) {
    window.postMessage({ type, payload }, location.origin);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== "SMARTRAIL_IRCTC_REQUEST") return;
    chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_GET" })
      .then(payload => sendToPage("SMARTRAIL_IRCTC_RESPONSE", payload || { installed: true, snapshots: [] }))
      .catch(() => sendToPage("SMARTRAIL_IRCTC_RESPONSE", { installed: false, snapshots: [] }));
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "SMARTRAIL_IRCTC_UPDATE" && Array.isArray(message.snapshots)) {
      sendToPage("SMARTRAIL_IRCTC_UPDATE", { installed: true, snapshots: message.snapshots });
    }
  });
})();

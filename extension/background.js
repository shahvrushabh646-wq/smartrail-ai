const STORAGE_KEY = "smartrail_irctc_snapshots";
const MAX_SNAPSHOTS = 80;

function cleanSnapshot(input) {
  if (!input || typeof input !== "object") return null;
  const trainNo = String(input.trainNo || "").replace(/\D/g, "").slice(0, 5);
  const travelClass = String(input.travelClass || "").toUpperCase().trim();
  const statusText = String(input.statusText || "").trim().slice(0, 100);
  const allowedClasses = new Set(["1A","2A","3A","3E","SL","2S","CC","EC","EA","EV","FC"]);
  if (!/^\d{5}$/.test(trainNo) || !allowedClasses.has(travelClass) || !statusText) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? input.date : "";
  return {
    trainNo,
    trainName: String(input.trainName || "").trim().slice(0, 100),
    travelClass,
    statusText,
    status: String(input.status || "UNKNOWN").slice(0, 20),
    date,
    observedAt: new Date().toISOString(),
    source: "IRCTC page visible in your browser"
  };
}

async function broadcastSnapshots(snapshots) {
  const tabs = await chrome.tabs.query({
    url: ["https://*.vercel.app/*", "https://smartrail-ai-mu.vercel.app/*", "https://smartrail-git-feature-visible-irctc-extension-v2-vs-38ee.vercel.app/*", "http://localhost:5173/*"]
  });
  await Promise.all(tabs.map(tab => tab.id == null ? Promise.resolve() :
    chrome.tabs.sendMessage(tab.id, { type: "SMARTRAIL_IRCTC_UPDATE", snapshots }).catch(() => null)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SMARTRAIL_IRCTC_AUTO_OPEN") {
    const senderUrl = sender?.url || "";
    const allowedSender = senderUrl.startsWith("https://smartrail-ai-mu.vercel.app/") ||
      (senderUrl.startsWith("https://") && senderUrl.includes(".vercel.app/")) ||
      senderUrl.startsWith("http://localhost:5173/");
    if (!allowedSender) {
      sendResponse({ ok: false, error: "Untrusted SmartRail sender" });
      return;
    }
    (async () => {
      const existing = await chrome.tabs.query({ url: ["https://www.irctc.co.in/*"] });
      const tab = existing.find(item => item.url?.includes("/nget/train-search")) || existing[0];
      if (tab?.id != null) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ ok: true, opened: false, tabId: tab.id });
        return;
      }
      const created = await chrome.tabs.create({ url: "https://www.irctc.co.in/nget/train-search", active: true });
      sendResponse({ ok: true, opened: true, tabId: created.id });
    })().catch(error => sendResponse({ ok: false, error: error?.message || "Could not open IRCTC" }));
    return true;
  }
  if (message?.type === "SMARTRAIL_IRCTC_STORE") {
    const senderUrl = sender?.url || "";
    if (!senderUrl.startsWith("https://www.irctc.co.in/")) {
      sendResponse({ ok: false, error: "Untrusted sender" });
      return;
    }
    (async () => {
      const incoming = Array.isArray(message.snapshots) ? message.snapshots : [];
      const cleaned = incoming.map(cleanSnapshot).filter(Boolean);
      if (!cleaned.length) {
        sendResponse({ ok: true, saved: 0 });
        return;
      }
      const previous = await chrome.storage.local.get(STORAGE_KEY);
      const old = Array.isArray(previous[STORAGE_KEY]) ? previous[STORAGE_KEY] : [];
      const merged = [...cleaned, ...old].filter((item, index, all) =>
        all.findIndex(other => other.trainNo === item.trainNo &&
          other.travelClass === item.travelClass && other.date === item.date) === index
      ).slice(0, MAX_SNAPSHOTS);
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
      await broadcastSnapshots(merged);
      sendResponse({ ok: true, saved: cleaned.length });
    })().catch(error => sendResponse({ ok: false, error: error?.message || "Storage error" }));
    return true;
  }

  if (message?.type === "SMARTRAIL_IRCTC_GET") {
    chrome.storage.local.get(STORAGE_KEY).then(result => {
      sendResponse({ installed: true, snapshots: Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [] });
    }).catch(() => sendResponse({ installed: true, snapshots: [] }));
    return true;
  }

  if (message?.type === "SMARTRAIL_IRCTC_CLEAR") {
    chrome.storage.local.remove(STORAGE_KEY).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

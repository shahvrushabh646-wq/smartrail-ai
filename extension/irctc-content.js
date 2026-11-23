(() => {
  const CLASS_RE = /\b(1A|2A|3A|3E|SL|2S|CC|EC|EA|EV|FC)\b/i;
  const STATUS_RE = /\b(AVAILABLE\s*[-: ]\s*\d+|AVAIL(?:ABLE)?\s*\d+|RAC\s*[-: ]?\s*\d+|WL\s*[-: ]?\s*\d+|WAITLIST\s*[-: ]?\s*\d+|REGRET|NOT\s+AVAILABLE)\b/i;
  let lastSignature = "";

  function pageDate() {
    const params = new URLSearchParams(location.search);
    for (const key of ["journeyDate", "journey_date", "date", "trainDate"]) {
      const raw = params.get(key);
      if (!raw) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const match = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (match) return match[3] + "-" + match[2] + "-" + match[1];
    }
    const text = document.body?.innerText || "";
    const match = text.match(/\b(\d{2})[-/](\d{2})[-/](\d{4})\b/);
    return match ? match[3] + "-" + match[2] + "-" + match[1] : "";
  }

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function capture() {
    if (!location.hostname.endsWith("irctc.co.in") || !document.body) return;
    const date = pageDate();
    const candidates = Array.from(document.querySelectorAll("tr,[role='row'],.availability,.train-list,.trainList,.train-card,.trainCard,.ng-star-inserted"));
    const rows = [];
    const seen = new Set();
    for (const element of candidates) {
      if (!visible(element)) continue;
      const text = (element.innerText || "").replace(/\s+/g, " ").trim();
      if (text.length < 12 || text.length > 900 || !STATUS_RE.test(text)) continue;
      const trainMatch = text.match(/\b\d{5}\b/);
      const classMatch = text.match(CLASS_RE);
      const statusMatch = text.match(STATUS_RE);
      if (!trainMatch || !classMatch || !statusMatch) continue;
      const trainNo = trainMatch[0];
      const travelClass = classMatch[1].toUpperCase();
      const statusText = statusMatch[1].replace(/\s+/g, " ").trim().toUpperCase();
      const key = [trainNo, travelClass, statusText, date].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const status = /\bAVAILABLE\b|\bAVAIL\b/.test(statusText) ? "AVAILABLE"
        : /\bRAC\b/.test(statusText) ? "RAC"
        : /\bWL\b|WAITLIST/.test(statusText) ? "WAITLIST"
        : /REGRET|NOT AVAILABLE/.test(statusText) ? "NOT_AVAILABLE" : "UNKNOWN";
      rows.push({
        trainNo,
        trainName: text.replace(trainNo, "").slice(0, 100),
        travelClass,
        statusText,
        status,
        date
      });
    }
    if (!rows.length) return;
    const signature = JSON.stringify(rows);
    if (signature === lastSignature) return;
    lastSignature = signature;
    chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_STORE", snapshots: rows }).catch(() => {});
  }

  let timer;
  const scheduleCapture = () => {
    clearTimeout(timer);
    timer = setTimeout(capture, 900);
  };
  const observer = new MutationObserver(scheduleCapture);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleCapture();
  setInterval(capture, 5000);
})();

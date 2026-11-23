(() => {
  const CLASS_RE = /\b(1A|2A|3A|3E|SL|2S|CC|EC|EA|EV|FC)\b/i;
  const STATUS_RE = /\b(AVAILABLE\s*[-: ]\s*\d+|AVAIL(?:ABLE)?\s*\d+|RAC\s*[-: ]?\s*\d+|WL\s*[-: ]?\s*\d+|WAITLIST\s*[-: ]?\s*\d+|REGRET|NOT\s+AVAILABLE)\b/i;
  let lastSignature = "";
  let activeSearch = null;
  let availabilityTriggered = false;

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

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalizeStation = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function setInputValue(input, value) {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
    return true;
  }

  function findVisibleInput(selectors) {
    for (const selector of selectors) {
      const input = Array.from(document.querySelectorAll(selector)).find(visible);
      if (input) return input;
    }
    return null;
  }

  async function fillStation(input, station) {
    if (!input) return false;
    input.focus();
    setInputValue(input, station);
    await wait(900);
    const wanted = normalizeStation(station);
    const options = Array.from(document.querySelectorAll("[role='option'],mat-option,li,.ui-autocomplete-item,.autocomplete-item,.station-item"))
      .filter(visible)
      .filter(item => {
        const text = normalizeStation(item.innerText || item.textContent);
        return text && (text.includes(wanted) || wanted.includes(text));
      });
    if (options.length) {
      const choice = options.find(item => normalizeStation(item.innerText || item.textContent).startsWith(wanted)) || options[0];
      choice.click();
      await wait(300);
      return true;
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true }));
    await wait(120);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    await wait(250);
    return !!input.value;
  }

  async function selectTravelClass(travelClass) {
    if (!travelClass || travelClass === "ALL") return true;
    for (const select of Array.from(document.querySelectorAll("select")).filter(visible)) {
      const option = Array.from(select.options).find(item => item.text.trim().toUpperCase() === travelClass || item.value.trim().toUpperCase() === travelClass);
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    const dropdown = Array.from(document.querySelectorAll("button,[role='button'],.dropdown-toggle"))
      .filter(visible).find(item => /all classes|class/i.test(item.innerText || item.getAttribute("aria-label") || ""));
    if (dropdown) {
      dropdown.click();
      await wait(250);
      const option = Array.from(document.querySelectorAll("[role='option'],li,button,a"))
        .filter(visible).find(item => (item.innerText || item.textContent || "").trim().toUpperCase() === travelClass);
      if (option) { option.click(); await wait(200); return true; }
    }
    return false;
  }

  function bridgeStatus(status) {
    chrome.runtime.sendMessage({ type: "SMARTRAIL_IRCTC_BRIDGE_STATUS", status }).catch(() => {});
  }

  async function automaticJourneySearch(payload) {
    if (!payload?.from || !payload?.to || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.date || "")) {
      return { ok: false, error: "SmartRail journey details are incomplete." };
    }
    activeSearch = { ...payload, submitted: false };
    const fromInput = findVisibleInput([
      'input[placeholder*="From" i]', 'input[aria-label*="From" i]', 'input[formcontrolname*="origin" i]', 'input[id*="origin" i]', 'input[name*="from" i]'
    ]);
    const toInput = findVisibleInput([
      'input[placeholder*="To" i]', 'input[aria-label*="To" i]', 'input[formcontrolname*="destination" i]', 'input[id*="destination" i]', 'input[name*="to" i]'
    ]);
    if (!fromInput || !toInput) {
      bridgeStatus("IRCTC opened, but station fields could not be identified on this page.");
      return { ok: false, error: "IRCTC station fields were not detected." };
    }
    bridgeStatus("Automatically filling IRCTC journey stations…");
    const fromOk = await fillStation(fromInput, payload.from);
    const toOk = await fillStation(toInput, payload.to);
    if (!fromOk || !toOk) {
      bridgeStatus("Station autocomplete needs confirmation on IRCTC.");
      return { ok: false, error: "Station suggestions could not be selected automatically." };
    }

    const dateInput = findVisibleInput([
      'input[formcontrolname*="journeyDate" i]', 'input[placeholder*="date" i]', 'input[aria-label*="date" i]', 'input[id*="journeyDate" i]', 'input[name*="date" i]'
    ]);
    if (dateInput) {
      const [year, month, day] = payload.date.split("-");
      const value = dateInput.type === "date" ? payload.date : day + "/" + month + "/" + year;
      setInputValue(dateInput, value);
      dateInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    }
    const classSelected = await selectTravelClass(payload.travelClass);
    await wait(300);
    const searchButton = Array.from(document.querySelectorAll("button,input[type='submit'],[role='button']"))
      .filter(visible).find(item => /^search$/i.test((item.innerText || item.value || item.getAttribute("aria-label") || "").trim()));
    if (!searchButton) {
      bridgeStatus("Journey details filled. Please review and press Search on IRCTC.");
      return { ok: true, message: "Journey details filled; Search button needs confirmation." };
    }
    searchButton.click();
    activeSearch.submitted = true;
    bridgeStatus("IRCTC journey search submitted. Capturing visible availability…");
    await wait(3500);
    clickClassAvailability(payload.travelClass);
    if (!classSelected && payload.travelClass !== "ALL") bridgeStatus("Search started; please confirm the selected travel class on IRCTC.");
    return { ok: true, message: "IRCTC journey search submitted automatically." };
  }

  function clickClassAvailability(travelClass) {
    if (!activeSearch?.submitted || !travelClass || travelClass === "ALL" || availabilityTriggered) return;
    availabilityTriggered = true;
    const controls = Array.from(document.querySelectorAll("button,[role='button'],a"))
      .filter(visible)
      .filter(item => (item.innerText || item.textContent || "").trim().toUpperCase() === travelClass)
      .slice(0, 8);
    controls.forEach((control, index) => setTimeout(() => {
      if (!control.dataset.smartrailAvailabilityClicked) {
        control.dataset.smartrailAvailabilityClicked = "1";
        control.click();
      }
    }, index * 450));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SMARTRAIL_IRCTC_AUTO_SEARCH") {
      automaticJourneySearch(message.payload || {}).then(sendResponse).catch(error =>
        sendResponse({ ok: false, error: error?.message || "Automatic journey search failed." }));
      return true;
    }
  });

  let timer;
  const scheduleCapture = () => {
    clearTimeout(timer);
    timer = setTimeout(capture, 900);
  };
  const observer = new MutationObserver(() => {
    scheduleCapture();
    clickClassAvailability(activeSearch?.travelClass);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleCapture();
  setInterval(capture, 5000);
})();

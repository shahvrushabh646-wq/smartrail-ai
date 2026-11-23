# SmartRail AI — IRCTC Availability Bridge

This is an optional Chrome extension companion for SmartRail AI. It reads **only text currently visible on an IRCTC page opened by you** and sends the detected train number, class, status and date to SmartRail in the same browser. It does not call a separate availability API, log in, book tickets, submit forms, read cookies, or bypass CAPTCHA.

## Install (Chrome / Edge)

1. Download or clone the SmartRail AI repository.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the repository's `extension` folder.
5. Open SmartRail AI at https://smartrail-ai-mu.vercel.app/ and leave it open in a tab.
6. Open IRCTC in another tab, search your journey, and expand/check availability so the status is visible on the page.
7. Return to SmartRail and press **Refresh from browser extension**. Captured status rows should appear in the SmartRail page.

## Important

- This is a browser-side bridge, not a guaranteed official live data feed. IRCTC may change its page structure; the extension only captures rows it can recognize.
- It cannot show availability when the relevant status is not displayed in the IRCTC page.
- The extension stores up to 80 recent class-status observations in Chrome local extension storage. Use SmartRail's clear button to remove them.
- Statuses include an observation timestamp and should be refreshed before booking.
- No status is generated if the page's visible content cannot be parsed. A missing row means **not captured**, not unavailable.

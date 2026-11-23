# SmartRail AI — IRCTC Availability Bridge

The extension bridges **only status text currently visible** on your own IRCTC page to SmartRail in the same Chrome/Edge browser. It does not call a separate availability API, log in, book tickets, submit forms, read cookies, or bypass CAPTCHA.

## Install (one-time)

1. Download and extract the SmartRail AI repository ZIP.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the repository's `extension` folder.
5. Open SmartRail AI: https://smartrail-ai-mu.vercel.app/

After installation, press **Search trains** in SmartRail. The extension sends your selected origin, destination, journey date and class to the bridge, opens or focuses the IRCTC train-search page, and attempts to fill and submit the visible journey form. It then checks visible class availability controls and sends status text back to SmartRail. Login, CAPTCHA, or station/date picker confirmation may still require your action. This is browser UI automation initiated by your SmartRail search, not a backend IRCTC feed.

## Important

- This is a browser-side bridge, not an official or guaranteed live data feed.
- The extension cannot read status that IRCTC does not display visibly.
- IRCTC login, journey search, and CAPTCHA remain user-controlled.
- It stores up to 80 recent class-status observations in Chrome local extension storage. Use SmartRail's clear button to remove them.
- Statuses include an observation timestamp. Recheck before booking.
- A missing row means **not captured**, not unavailable.

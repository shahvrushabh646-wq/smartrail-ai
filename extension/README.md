# SmartRail AI — IRCTC Availability Bridge

The extension bridges **only status text currently visible** on your own IRCTC page to SmartRail in the same Chrome/Edge browser. It does not call a separate availability API, log in, book tickets, submit forms, read cookies, or bypass CAPTCHA.

## Install (one-time)

1. Download and extract the SmartRail AI repository ZIP.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the repository's `extension` folder.
5. Open SmartRail AI: https://smartrail-ai-mu.vercel.app/

After installation, press **Search trains** in SmartRail. The extension automatically opens or focuses an IRCTC tab. Sign in if needed, search your journey on IRCTC, and make the class-wise availability text visible; the bridge captures it and sends it to SmartRail.

## Important

- This is a browser-side bridge, not an official or guaranteed live data feed.
- The extension cannot read status that IRCTC does not display visibly.
- IRCTC login, journey search, and CAPTCHA remain user-controlled.
- It stores up to 80 recent class-status observations in Chrome local extension storage. Use SmartRail's clear button to remove them.
- Statuses include an observation timestamp. Recheck before booking.
- A missing row means **not captured**, not unavailable.

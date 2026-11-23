# SmartRail AI

SmartRail uses its local timetable for route display and the SmartRail Chrome extension as a browser bridge for availability text visible on your own IRCTC page.

## Chrome bridge

1. Download the repository ZIP and extract it.
2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the repository's `extension` folder.
5. Open SmartRail AI: https://smartrail-ai-mu.vercel.app/
6. Press **Search trains**. The extension automatically opens or focuses an IRCTC tab.
7. On IRCTC, sign in if needed, search the same journey, and make the class-wise availability text visible. SmartRail receives visible status text through the extension bridge.

## Important limitations

- Server-side third-party provider integrations and provider-key setup are disabled.
- The bridge does not run a remote browser or fetch private IRCTC endpoints. It reads only status text already visible in your own browser.
- IRCTC login, journey search, and CAPTCHA remain user-controlled. The extension does not submit forms, book tickets, read cookies, or bypass anti-bot protections.
- The Chrome extension must be installed and enabled locally. A website cannot silently install or run a browser extension.
- Seat status is a browser-captured observation, not a guaranteed official feed. Refresh it before booking.
- If IRCTC does not display a matching status on the page, SmartRail will show no captured status rather than invent availability.

# Install Data Dawgs

The shared Install Data Dawgs button opens help only when tapped. It appears beside the shared footer links; private/research pages place it inside the compact app-switching menu. It is hidden in standalone mode. The protected stats.html page is unchanged per AGENTS.md.

On iPhone, open https://datadawgs216.com in Safari, open Share (possibly inside Page Menu), choose Add to Home Screen, turn on Open as Web App if shown, then Add. If the action is absent, use Edit Actions at the bottom of the share sheet. Source: [Apple's iPhone guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), checked 2026-10-16.

Android offers the captured browser install prompt only after an explicit click, otherwise describes Chrome's menu fallback. Desktop uses the browser install menu or a bookmark. No automatic popup, installation claim, account change, permission change, storage or external request is introduced. Existing manifest, icons, root scope and start URL are unchanged.

Validation simulates platform signals in Chromium; it is not a physical iPhone/Safari installation test. The native dialog supports focus containment, Escape and focus return, including fallback to the visible app-menu summary after the menu closes. Responsive checks cover 320, 390, 768 and 1440 pixels.

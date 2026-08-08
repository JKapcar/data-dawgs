/* Resolve Playwright from the repo when installed normally, or from the bundled
   Codex Node runtime without creating a machine-specific symlink in work/node_modules.
   DD_NODE_MODULES remains an explicit escape hatch for any other CI/runtime layout. */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

export function loadPlaywright() {
  const roots = [
    null,
    process.env.DD_NODE_MODULES || null,
    path.resolve(path.dirname(process.execPath), "..", "node_modules"),
  ].filter((value, index, all) => value === null || all.indexOf(value) === index);
  const tried = [];
  for (const root of roots) {
    try {
      const require = root
        ? createRequire(path.join(root, "__data_dawgs_playwright_resolver.cjs"))
        : createRequire(import.meta.url);
      return require("playwright");
    } catch (error) {
      tried.push(root || "local node_modules");
    }
  }
  throw new Error("Playwright is not resolvable. Install it locally or set DD_NODE_MODULES. Tried: " + tried.join(", "));
}

export function chromiumExecutable(chromium) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM,
    chromium.executablePath(),
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find(file => fs.existsSync(file));
  if (found) return found;
  throw new Error("No Chromium executable found. Set PLAYWRIGHT_CHROMIUM. Tried: " + candidates.join(", "));
}

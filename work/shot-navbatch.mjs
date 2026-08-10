/* Screenshots for Stage NB. Not a suite — this exists because every real bug on this repo
   in the last week was found by looking, not by an assertion. Writes /tmp/shots/*.png and
   prints the geometry facts a picture cannot be trusted to convey on its own. */
import { mkdirSync } from "fs";
import { pathToFileURL } from "url";
import { loadPlaywright, chromiumExecutable } from "./playwright-loader.mjs";

const { chromium } = loadPlaywright();
mkdirSync("/tmp/shots", { recursive: true });
const url = (f) => pathToFileURL(process.cwd() + "/" + f).href;
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium) });

const facts = [];

for (const theme of ["dark", "light"]) {
  for (const [file, W, H, label] of [
    ["receipts.html", 1280, 800, "receipts-menu"],
    ["dashboard.html", 1280, 800, "dashboard-head"],
    ["dashboard.html", 420, 800, "dashboard-head-420"],
    ["dashboard.html", 320, 800, "dashboard-head-320"],
    ["dawghouse.html", 1280, 800, "dawghouse-active"],
  ]) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.goto(url(file));
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await p.waitForTimeout(350);

    if (label === "receipts-menu") {
      // open the Receipts dropdown the way a mouse does
      await p.evaluate(() => {
        const g = [...document.querySelectorAll(".navgrp")].find(
          (x) => x.querySelector(".grpbtn")?.textContent.includes("Receipts"));
        g.classList.add("open");
      });
      await p.waitForTimeout(200);
      facts.push([theme, "receipts menu items", await p.evaluate(() => {
        const g = [...document.querySelectorAll(".navgrp")].find(
          (x) => x.querySelector(".grpbtn")?.textContent.includes("Receipts"));
        const m = g.querySelector(".grpmenu");
        const r = m.getBoundingClientRect();
        return [...m.querySelectorAll("a")].map(a => a.textContent).join(" | ")
          + `  [menu right=${Math.round(r.right)} of ${innerWidth}, bottom=${Math.round(r.bottom)}]`;
      })]);
      facts.push([theme, "arena menu items", await p.evaluate(() => {
        const g = [...document.querySelectorAll(".navgrp")].find(
          (x) => x.querySelector(".grpbtn")?.textContent.includes("Arena"));
        return [...g.querySelectorAll(".grpmenu a")].map(a => a.textContent).join(" | ");
      })]);
    }

    if (file === "dashboard.html") {
      facts.push([theme, `dbhead @${W}`, await p.evaluate(() => {
        const s = document.querySelector(".dbsetup");
        const w = document.querySelector(".dbhead .who");
        const h = document.querySelector(".dbhead h1");
        if (!s) return "NO .dbsetup";
        const rs = s.getBoundingClientRect(), rh = h.getBoundingClientRect();
        const rw = w.getBoundingClientRect();
        const overlap = (a, x) => Math.max(0, Math.min(a.right, x.right) - Math.max(a.left, x.left))
          * Math.max(0, Math.min(a.bottom, x.bottom) - Math.max(a.top, x.top));
        return `setup=${Math.round(rs.left)},${Math.round(rs.top)} ${Math.round(rs.width)}x${Math.round(rs.height)}`
          + ` visible=${rs.width > 0 && rs.height > 0} inViewport=${rs.right <= innerWidth + 0.5}`
          + ` overlapH1=${Math.round(overlap(rs, rh))}px2 overlapWho=${Math.round(overlap(rs, rw))}px2`
          + ` colour=${getComputedStyle(s).color}`;
      })]);
    }

    if (label === "dawghouse-active") {
      facts.push([theme, "active nav group on the shelf", await p.evaluate(() => {
        const on = [...document.querySelectorAll(".sitenav .grpbtn.on")].map(x => x.textContent.trim());
        const item = [...document.querySelectorAll(".sitenav .grpmenu a.on")].map(x => x.textContent);
        return `group=[${on}] item=[${item}]`;
      })]);
    }

    // sideways overflow, the sitewide trap
    const of = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (of > 0) facts.push([theme, `OVERFLOW ${file} @${W}`, of + "px"]);

    await p.screenshot({ path: `/tmp/shots/${label}-${theme}.png`, clip: { x: 0, y: 0, width: W, height: Math.min(H, 420) } });
    await p.close();
  }
}
await b.close();
for (const [t, k, v] of facts) console.log(`[${t}] ${k}: ${v}`);

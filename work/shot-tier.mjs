/* Screenshots for Stage TR. Not a suite. The assertions prove the WORDS are consistent;
   only a picture proves the word still fits. "Pup" is 3 characters where "Labs" was 4 and
   "Working Dawg" is 12, so the risk here is layout, not vocabulary: a hero chip that now
   wraps, a lifecycle chip that outgrows its pill, or a label that collides with the h1.

   Writes /tmp/shots-tier/*.png and prints the geometry facts a picture cannot be trusted
   to convey on its own. Per feedback_fixed_elements: a collision test at scroll 0 proves
   nothing, so the hero rows are measured at the narrow viewports where they actually fail. */
import { mkdirSync } from "fs";
import { pathToFileURL } from "url";
import { loadPlaywright, chromiumExecutable } from "./playwright-loader.mjs";

const { chromium } = loadPlaywright();
mkdirSync("/tmp/shots-tier", { recursive: true });
const url = (f) => pathToFileURL(process.cwd() + "/" + f).href;
const b = await chromium.launch({ executablePath: chromiumExecutable(chromium) });

const facts = [];
const problems = [];

const CHIP_PAGES = ["arena.html", "data.html", "nfl.html", "calculators.html",
  "receipts.html", "survivor.html", "dawghouse.html"];

for (const theme of ["dark", "light"]) {
  // ---------------------------------------------- the six relabelled hero chips
  for (const W of [1280, 420, 320]) {
    for (const file of CHIP_PAGES) {
      const p = await b.newPage({ viewport: { width: W, height: 800 } });
      await p.goto(url(file));
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(250);

      const r = await p.evaluate(() => {
        const chip = document.querySelector(".tierchip");
        if (!chip) return { missing: true };
        const h1 = chip.closest("h1");
        const cb = chip.getBoundingClientRect();
        const cs = getComputedStyle(chip);
        return {
          text: chip.textContent.trim(),
          w: Math.round(cb.width), h: Math.round(cb.height),
          right: Math.round(cb.right),
          viewport: window.innerWidth,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          colour: cs.color,
          // a chip is one line by design; two lines means the pill broke
          lines: (() => { const rg = document.createRange(); rg.selectNodeContents(chip); return rg.getClientRects().length; })(),
          h1Lines: h1 ? Math.round(h1.getBoundingClientRect().height /
            parseFloat(getComputedStyle(h1).lineHeight)) : null,
        };
      });

      if (r.missing) { problems.push(`${file} @${W} ${theme}: no .tierchip found`); }
      else {
        facts.push([theme, `${file} @${W}`, `"${r.text}" ${r.w}x${r.h}px right=${r.right}/${r.viewport} colour=${r.colour}`]);
        if (r.docOverflow > 0)
          problems.push(`${file} @${W} ${theme}: document overflows sideways by ${r.docOverflow}px`);
        if (r.lines > 1)
          problems.push(`${file} @${W} ${theme}: chip "${r.text}" wrapped to ${r.lines} lines`);
        if (r.right > r.viewport)
          problems.push(`${file} @${W} ${theme}: chip right edge ${r.right} is past the viewport ${r.viewport}`);
      }
      if (W === 1280) await p.screenshot({ path: `/tmp/shots-tier/${theme}-chip-${file.replace(".html", "")}.png` });
      await p.close();
    }
  }

  // ---------------------------------------------- index.html#tiers, the lifecycle
  for (const W of [1280, 420]) {
    const p = await b.newPage({ viewport: { width: W, height: 1000 } });
    // pathToFileURL percent-encodes "#", so the fragment has to be appended after
    await p.goto(url("index.html") + "#tiers");
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await p.waitForTimeout(350);
    await p.evaluate(() => document.getElementById("tiers")?.scrollIntoView());
    await p.waitForTimeout(250);

    const r = await p.evaluate(() => {
      const chips = [...document.querySelectorAll(".lc-chip")];
      return {
        chips: chips.map(c => {
          const cb = c.getBoundingClientRect();
          const cs = getComputedStyle(c);
          return {
            text: c.textContent.trim(), w: Math.round(cb.width), h: Math.round(cb.height),
            colour: cs.color,
            // Count LINE BOXES, not height/line-height: these pills carry vertical
            // padding, so the arithmetic version reports 2 for every chip including
            // ones this stage never touched. A Range over the text node is the only
            // reading that means what it says.
            lines: (() => {
              const rg = document.createRange();
              rg.selectNodeContents(c);
              return rg.getClientRects().length;
            })(),
          };
        }),
        headings: [...document.querySelectorAll(".lc h3")].map(h => h.textContent.trim()),
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    for (const c of r.chips)
      facts.push([theme, `index#tiers @${W}`, `chip "${c.text}" ${c.w}x${c.h}px lines=${c.lines} colour=${c.colour}`]);
    facts.push([theme, `index#tiers @${W}`, `headings ${JSON.stringify(r.headings)}`]);
    if (r.docOverflow > 0)
      problems.push(`index.html#tiers @${W} ${theme}: document overflows sideways by ${r.docOverflow}px`);
    for (const c of r.chips)
      if (c.lines > 1) problems.push(`index.html#tiers @${W} ${theme}: chip "${c.text}" wrapped to ${c.lines} lines`);

    await p.screenshot({ path: `/tmp/shots-tier/${theme}-tiers-${W}.png`, fullPage: false });
    await p.close();
  }
}

await b.close();

for (const [theme, where, what] of facts) console.log(`  ${theme.padEnd(5)} ${where.padEnd(26)} ${what}`);
console.log();
if (problems.length) {
  console.log(`${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  " + p);
  process.exitCode = 1;
} else {
  console.log("no overflow, no wrapped chip, no chip past the viewport — in both themes");
}
console.log("PNGs in /tmp/shots-tier/");

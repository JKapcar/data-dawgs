/* Read the ESPN Draft Kit cheat-sheet PDF into rows.
 *
 * ⚠️ DO NOT REGEX THE FLAT TEXT. The sheet is laid out in parallel columns, and the
 * text layer interleaves them, so a line-oriented regex silently welds the D/ST column
 * onto the QB column: "27. (220) Jacoby Brissett, Broncos D/ST (Wk 1: @KC) $1 10" is
 * two different entries, and the quarterback's own team and price are simply gone.
 * That dropped about eight $1-tier QBs without a word.
 *
 * So read positions instead: cluster text items into rows by y, split each row into
 * column bands by x, and parse each cell on its own. Every cell that looks like an
 * entry but does not parse is reported, never dropped.
 *
 *   node work/parse-espn-pdf.mjs <pdf> [out.json]
 */
import fs from "node:fs";

const ENTRY = /^(\d+)\.\s*\((\d+)\)$/;                     // "12. (21)"
const NAMED = /^(.+?),\s*([A-Za-z0-9/.\s]+?)$/;            // "Kenneth Walker III, KC"

export async function parseEspnPdf(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const rows = [], unparsed = [];

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const tc = await (await doc.getPage(pn)).getTextContent();
    const items = tc.items
      .map(i => ({ x: i.transform[4], y: Math.round(i.transform[5]), s: i.str }))
      .filter(i => i.s.trim());

    // group into visual rows by y
    const byY = new Map();
    for (const it of items) { if (!byY.has(it.y)) byY.set(it.y, []); byY.get(it.y).push(it); }

    for (const [, line] of byY) {
      line.sort((a, b) => a.x - b.x);
      /* A new column starts wherever an entry marker "N. (M)" appears. That is the only
         reliable separator: gaps vary with name length, but the marker never does. */
      const starts = line.map((it, i) => ENTRY.test(it.s.trim()) ? i : -1).filter(i => i >= 0);
      for (let k = 0; k < starts.length; k++) {
        const cell = line.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : line.length);
        const m = ENTRY.exec(cell[0].s.trim());
        const rest = cell.slice(1).map(c => c.s).join(" ").replace(/\s+/g, " ").trim();
        // "Josh Allen, BUF $22 7"  →  name, team, price, bye
        const mm = /^(.*?)\s*\$(\d+)\b/.exec(rest);
        if (!mm) { unparsed.push(rest.slice(0, 60)); continue; }
        const who = NAMED.exec(mm[1].trim());
        if (!who) { unparsed.push(rest.slice(0, 60)); continue; }
        const team = who[2].trim();
        // Skip the team-defense column: it names a franchise, not a player.
        if (/D\/ST/i.test(mm[1]) || /D\/ST/i.test(team)) continue;
        rows.push({ posRank: +m[1], overall: +m[2], name: who[1].trim(), team, price: +mm[2] });
      }
    }
  }
  return { rows, unparsed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, unparsed } = await parseEspnPdf(process.argv[2]);
  const uniq = new Map(rows.map(r => [r.name.toLowerCase() + "|" + r.overall, r]));
  console.log(`parsed ${rows.length} entries, ${uniq.size} unique, $${[...uniq.values()].reduce((a, r) => a + r.price, 0)} total`);
  console.log(`unparsed cells: ${unparsed.length}`);
  if (unparsed.length) console.log("  " + unparsed.slice(0, 8).join(" | "));
  const qb = [...uniq.values()].filter(r => /Ward|Geno|Tagovailoa|Penix|McCarthy|Brissett|Cousins|Sanders/.test(r.name));
  console.log("previously-swallowed QBs now recovered:", qb.map(r => `${r.name} $${r.price}`).join(", ") || "NONE");
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify([...uniq.values()], null, 1));
}

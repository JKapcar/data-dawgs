#!/usr/bin/env node
"use strict";

/* Rebuild the two derived auction formats in every flattened draft-rig pool.
   The captured columns remain untouched. */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const HALF14_K = 0.906958;
const round1 = n => Math.round((n + Number.EPSILON) * 10) / 10;
// Native Superflex Half values from the owner's 2026-08-25 QB export. The export
// contains quarterbacks only; other positions use the captured half/full adjustment.
const SF_HALF_QB = Object.freeze({"Josh Allen":52,"Lamar Jackson":45,"Jayden Daniels":43,"Jalen Hurts":41,"Joe Burrow":41,"Drake Maye":39,"Justin Herbert":38,"Dak Prescott":37,"Caleb Williams":37,"Patrick Mahomes":35,"Trevor Lawrence":35,"Jaxson Dart":35,"Matthew Stafford":35,"Brock Purdy":34,"Jordan Love":34,"Kyler Murray":34,"Bo Nix":33,"Jared Goff":32,"Baker Mayfield":30,"Malik Willis":28,"Daniel Jones":25,"CJ Stroud":25,"Sam Darnold":25,"Tyler Shough":25,"Bryce Young":18,"Cameron Ward":17,"Aaron Rodgers":14,"Fernando Mendoza":12,"Geno Smith":4,"Carson Beck":0,"Deshaun Watson":0,"Dillon Gabriel":0,"Jacoby Brissett":0,"JJ McCarthy":0,"Kirk Cousins":0,"Michael Penix":0,"Shedeur Sanders":0,"Taylen Green":0,"Tua Tagovailoa":0});
const key = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
const SF_HALF_QB_BY_KEY = new Map(Object.entries(SF_HALF_QB).map(([name, value]) => [key(name), value]));

const pages = [
  ["master.html", "const POOL = ["],
  ["auction.html", "const POOL = ["],
  ["bigboard.html", "const POOL = ["],
  ["dataviz.html", "const POOL = ["],
  ["report.html", "const POOL = ["],
  ["board.html", "const SEED = ["],
  ["dashboard.html", "window.DD_POOL = ["],
];

function arraySpan(source, marker) {
  const markerAt = source.indexOf(marker);
  if (markerAt < 0 || source.indexOf(marker, markerAt + 1) >= 0) throw new Error(`${marker}: expected exactly once`);
  const start = source.indexOf("[", markerAt);
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return { start, end: i + 1 };
  }
  throw new Error(`${marker}: unterminated array`);
}

function derive(pool) {
  const nativeNames = new Set();
  pool.forEach((p, i) => {
    p.half14 = p.half > 0 ? round1(1 + HALF14_K * Math.max(0, p.half - 1)) : 0;
    const nativeQb = p.pos === "QB" ? SF_HALF_QB_BY_KEY.get(key(p.name)) : undefined;
    if (nativeQb !== undefined) nativeNames.add(key(p.name));
    p.sfhalf12 = nativeQb !== undefined ? nativeQb : (p.sf > 0 ? round1(p.sf * (p.full > 0 ? p.half / p.full : 1)) : 0);
  });
  if (nativeNames.size !== SF_HALF_QB_BY_KEY.size) throw new Error(`matched ${nativeNames.size}/${SF_HALF_QB_BY_KEY.size} native Superflex Half quarterbacks`);
  const top210 = [...pool].sort((a, b) => b.half - a.half || a.rank - b.rank).slice(0, 210);
  const roomTotal = round1(top210.reduce((sum, p) => sum + p.half14, 0));
  if (Math.abs(roomTotal - 2800) > 1) throw new Error(`half14 top-210 total ${roomTotal} misses the $2,800 room budget`);
}

let canonical = null;
for (const [file, marker] of pages) {
  const filename = path.join(ROOT, file);
  const source = fs.readFileSync(filename, "utf8");
  const span = arraySpan(source, marker);
  const pool = JSON.parse(source.slice(span.start, span.end));
  derive(pool);
  const json = JSON.stringify(pool);
  if (canonical == null) canonical = json;
  else if (json !== canonical) throw new Error(`${file}: pool differs before/after derivation`);
  fs.writeFileSync(filename, source.slice(0, span.start) + json + source.slice(span.end));
}

console.log(`half14 k=${HALF14_K.toFixed(6)}; sfhalf12 native QB=${SF_HALF_QB_BY_KEY.size}, derived other positions; ${JSON.parse(canonical).length} players; ${pages.length} pages`);

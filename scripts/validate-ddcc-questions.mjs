import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../work/ddcc-core.js");
const TARGET = 60;

export function validateQuestionBank(records) {
  const errors = [], warnings = [];
  const ids = new Set(), claims = new Map();
  const domainKeys = new Set(Core.DOMAIN_KEYS);
  const counts = Object.fromEntries(Core.DOMAIN_KEYS.map(k => [k, { active: 0, true: 0, false: 0, total: 0 }]));
  const requiredText = ["id", "claim", "explanation", "sourceTitle", "sourceUrl", "sourceAccessedAt", "createdAt", "updatedAt"];
  if (!Array.isArray(records)) return { errors: ["root must be a JSON array"], warnings, counts };

  records.forEach((q, i) => {
    const at = `record ${i + 1}`;
    if (!q || typeof q !== "object" || Array.isArray(q)) { errors.push(`${at}: must be an object`); return; }
    requiredText.forEach(k => { if (typeof q[k] !== "string" || !q[k].trim()) errors.push(`${at}: ${k} is required`); });
    if (typeof q.truthValue !== "boolean") errors.push(`${at}: truthValue must be Boolean`);
    if (!domainKeys.has(q.domain)) errors.push(`${at}: unknown domain ${JSON.stringify(q.domain)}`);
    if (!Array.isArray(q.secondaryTags) || q.secondaryTags.some(x => typeof x !== "string" || !x.trim()))
      errors.push(`${at}: secondaryTags must be an array of non-empty strings`);
    if (!Number.isInteger(q.version) || q.version < 1) errors.push(`${at}: version must be a positive integer`);
    if (!["draft", "active", "retired"].includes(q.status)) errors.push(`${at}: invalid status`);
    if (typeof q.verified !== "boolean") errors.push(`${at}: verified must be Boolean`);
    if (q.status === "active" && q.verified !== true) errors.push(`${at}: active questions must be verified`);
    try { const u = new URL(q.sourceUrl); if (!/^https?:$/.test(u.protocol)) throw new Error(); }
    catch { errors.push(`${at}: sourceUrl must be an absolute http(s) URL`); }
    ["sourceAccessedAt", "asOfDate"].forEach(k => {
      if (q[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(q[k])) errors.push(`${at}: ${k} must be YYYY-MM-DD`);
    });
    if (q.id) {
      if (ids.has(q.id)) errors.push(`${at}: duplicate id ${q.id}`);
      ids.add(q.id);
    }
    if (q.claim) {
      const normalized = q.claim.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      if (claims.has(normalized)) errors.push(`${at}: duplicate normalized claim (also ${claims.get(normalized)})`);
      else claims.set(normalized, q.id || at);
    }
    if (counts[q.domain]) {
      counts[q.domain].total++;
      if (q.status === "active") {
        counts[q.domain].active++;
        counts[q.domain][q.truthValue ? "true" : "false"]++;
      }
    }
  });

  Core.DOMAIN_KEYS.forEach(k => {
    const c = counts[k];
    if (c.active < TARGET) warnings.push(`${k}: ${c.active}/${TARGET} active verified questions`);
    if (Math.abs(c.true - c.false) > 1) errors.push(`${k}: active truth balance is ${c.true} true / ${c.false} false`);
  });
  return { errors, warnings, counts };
}

export function loadAndValidate(file) {
  const full = path.resolve(file);
  const rows = JSON.parse(fs.readFileSync(full, "utf8"));
  return { full, rows, report: validateQuestionBank(rows) };
}

function printReport(report) {
  console.log("domain                               active  true false target");
  for (const k of Core.DOMAIN_KEYS) {
    const c = report.counts[k];
    console.log(`${k.padEnd(36)} ${String(c.active).padStart(6)} ${String(c.true).padStart(5)} ${String(c.false).padStart(5)} ${String(TARGET).padStart(6)}`);
  }
  report.warnings.forEach(x => console.warn("WARN " + x));
  report.errors.forEach(x => console.error("FAIL " + x));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
  const file = process.argv[2] || "private/ddcc-question-library.json";
  try {
    const { report } = loadAndValidate(file);
    printReport(report);
    if (report.errors.length) process.exit(1);
    console.log(`DDCC question bank valid: ${Object.values(report.counts).reduce((n, c) => n + c.active, 0)} active verified.`);
  } catch (e) {
    console.error("FAIL " + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
}

/* SwoleDawg — the D1 layer and the sd_* tools, against the ASSEMBLED Worker with a fake
   D1 that records every statement and its bindings. The Worker cannot be deployed from
   here, so this is where the write path has to prove itself before Kap ships it.

   What it is actually checking, in order of how much damage the bug would do:
     1. uid isolation — every statement binds a uid, and one athlete cannot read or write
        another's rows. This is the one that matters; the rest are correctness.
     2. the write gate — an anonymous caller writes nothing, ever.
     3. week derivation and sets_override, frozen onto the row at write time.
     4. corrections UPSERT instead of appending a contradictory second row.
     5. refusals — unknown exercise, invented measurement value, "hit target" as a number.

   Run:  cd work && node test-swoledawg.mjs
*/
import fs from "fs";
import { webcrypto } from "crypto";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const WORK = dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const BUNDLE = join(tmpdir(), "worker-swoledawg.mjs");
fs.writeFileSync(BUNDLE, SRC +
  "\nexport { MCP_TOOLS, swoleWeekOf, swoleEffortFor, swoleSetsFor, swoleStartSession," +
  " swoleLogSet, swoleFinishSession, swoleLogMeasurement, swoleLogNutrition, swoleNutrition, swoleSummary," +
  " swoleGetProgram, swolePutProgram, swoleSession, swoleDayKeyFor };\n");
globalThis.fetch = async () => new Response("null", { status: 404 });
const W = await import(pathToFileURL(BUNDLE).href);

/* ---------------- a fake D1 that remembers everything it was asked ---------------- */
// Rows live in plain arrays; only the handful of statements the layer issues are
// understood. The point is not to reimplement SQLite — it is to see the SQL and the
// bindings, so "did every statement carry a uid" is answerable.
const STATEMENTS = [];
function makeDb(seed) {
  const t = { sessions: [], sets: [], program: [], measurement_fields: [], measurements: [], nutrition: [], ...seed };
  const run = (sql, b) => {
    STATEMENTS.push({ sql, bind: b });
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT doc, version FROM program/.test(s)) {
      const r = t.program.filter(p => p.uid === b[0] && p.active).sort((x, y) => y.version - x.version)[0];
      return { first: r ? { doc: r.doc, version: r.version } : null };
    }
    if (/^SELECT MAX\(version\)/.test(s)) {
      const v = Math.max(0, ...t.program.filter(p => p.uid === b[0]).map(p => p.version));
      return { first: { v } };
    }
    if (/^UPDATE program SET active = 0/.test(s)) { t.program.forEach(p => { if (p.uid === b[0]) p.active = 0; }); return { first: null }; }
    if (/^INSERT INTO program/.test(s)) { t.program.push({ uid: b[0], version: b[1], doc: b[2], active: 1 }); return { first: null }; }
    if (/^SELECT id, started_at, completed_at FROM sessions WHERE id/.test(s))
      return { first: t.sessions.find(x => x.id === b[0] && x.uid === b[1]) || null };
    if (/^INSERT INTO sessions/.test(s)) {
      t.sessions.push({ id: b[0], uid: b[1], date: b[2], day_key: b[3], session_type: b[4], block: b[5], week: b[6], started_at: b[7] });
      return { first: null };
    }
    if (/^SELECT COUNT\(\*\) c FROM sets/.test(s))
      return { first: { c: t.sets.filter(x => x.uid === b[0] && x.session_id === b[1] && x.exercise_id === b[2]).length } };
    if (/^INSERT INTO sets/.test(s)) {
      const row = { uid: b[0], session_id: b[1], exercise_id: b[2], exercise_name: b[3], set_number: b[4],
                    weight_lb: b[5], reps: b[6], rir: b[7], rest_prescribed_s: b[8], rest_taken_s: b[9], source: b[10] };
      const at = t.sets.findIndex(x => x.session_id === row.session_id && x.exercise_id === row.exercise_id && x.set_number === row.set_number);
      if (at >= 0) t.sets[at] = row; else t.sets.push(row);   // the ON CONFLICT branch
      return { first: null };
    }
    if (/^SELECT set_number, weight_lb, reps FROM sets/.test(s))
      return { all: { results: t.sets.filter(x => x.uid === b[0] && x.session_id === b[1] && x.exercise_id === b[2]) } };
    if (/^SELECT id, day_key, week FROM sessions/.test(s))
      return { first: t.sessions.find(x => x.uid === b[0] && x.date === b[1]) || null };
    if (/^UPDATE sessions SET completed_at/.test(s)) { return { first: null }; }
    if (/^SELECT COUNT\(\*\) sets, SUM/.test(s)) {
      const rows = t.sets.filter(x => x.uid === b[0] && x.session_id === b[1]);
      return { first: { sets: rows.length, volume: rows.reduce((a, r) => a + r.weight_lb * r.reps, 0), exercises: new Set(rows.map(r => r.exercise_id)).size } };
    }
    if (/^SELECT field, label, direction, tag FROM measurement_fields/.test(s))
      return { first: t.measurement_fields.find(f => f.uid === b[0] && f.field === b[1]) || null };
    if (/^INSERT INTO measurements/.test(s)) {
      t.measurements.push({ uid: b[0], field: b[1], date: b[2], value: b[3], reads: b[4], source: b[5] });
      return { first: null };
    }
    if (/^INSERT INTO nutrition/.test(s)) { t.nutrition.push({ uid: b[0], date: b[1], kcal: b[2], protein_g: b[3] }); return { first: null }; }
    if (/^SELECT date, kcal, protein_g, note, source, logged_at FROM nutrition/.test(s))
      return { first: t.nutrition.find(x => x.uid === b[0] && x.date === b[1]) || null };
    if (/^SELECT date, kcal, protein_g, note, source FROM nutrition/.test(s))
      return { all: { results: t.nutrition.filter(x => x.uid === b[0]) } };
    if (/^SELECT \* FROM sessions/.test(s)) return { first: t.sessions.find(x => x.uid === b[0] && x.date === b[1]) || null };
    if (/^SELECT exercise_id, exercise_name/.test(s))
      return { all: { results: t.sets.filter(x => x.uid === b[0] && x.session_id === b[1]) } };
    return { first: null, all: { results: [] } };
  };
  const stmt = sql => ({
    bind: (...b) => ({
      async first() { return run(sql, b).first; },
      async all() { return run(sql, b).all || { results: [] }; },
      async run() { return run(sql, b); },
      _sql: sql, _bind: b,
    }),
  });
  return { prepare: stmt, async batch(list) { return list.map(x => x); }, _t: t };
}

const PROGRAM = {
  block: 1, block_start_date: "2026-08-17",
  effort_schedule: [
    { week: 1, reps_in_reserve: 4, sets_override: 2 },
    { week: 2, reps_in_reserve: 2, sets_override: null },
    { week: "4+", reps_in_reserve: 1, sets_override: null },
  ],
  days: [{ day: "monday", name: "Push", exercises: [
    { id: "mon_1", name: "Flat DB bench press", sets: 3, rep_min: 8, rep_max: 12, start_weight_lb_per_hand: 30, rest_between_sets: 180, rest_after_exercise: 180 },
    { id: "mon_5", name: "Lateral raise", sets: 3, rep_min: 12, rep_max: 15, start_weight_lb_per_hand: 10, rest_between_sets: 75, rest_after_exercise: 75 },
  ] }],
};
const seeded = () => makeDb({
  program: [{ uid: "kap", version: 1, doc: JSON.stringify(PROGRAM), active: 1 }],
  measurement_fields: [{ uid: "kap", field: "waist_navel_in", label: "Waist (navel)", direction: "down", tag: "OBSERVED" }],
});
const env = db => ({ SWOLE_DB: db });

console.log("\nweek derivation — frozen onto the row, never recomputed on read");
ok("the block's first Monday is week 1", W.swoleWeekOf(PROGRAM, "2026-08-17") === 1);
ok("Tuesday is still week 1", W.swoleWeekOf(PROGRAM, "2026-08-18") === 1);
ok("the following Monday turns over to week 2", W.swoleWeekOf(PROGRAM, "2026-08-24") === 2);
ok("a date BEFORE the block starts clamps to 1, never 0",
   W.swoleWeekOf(PROGRAM, "2026-08-10") === 1);
ok("…and therefore gets week 1's effort, not the most aggressive row",
   W.swoleEffortFor(PROGRAM, W.swoleWeekOf(PROGRAM, "2026-08-10")).reps_in_reserve === 4);
ok("week 5 falls through to the open-ended 4+ row", W.swoleEffortFor(PROGRAM, 5).reps_in_reserve === 1);
ok("week 1's sets_override beats the exercise table",
   W.swoleSetsFor(PROGRAM.days[0].exercises[0], W.swoleEffortFor(PROGRAM, 1)) === 2);
ok("week 2 uses the table", W.swoleSetsFor(PROGRAM.days[0].exercises[0], W.swoleEffortFor(PROGRAM, 2)) === 3);

console.log("\nlogging a set");
{
  const db = seeded();
  const r = await W.swoleLogSet(env(db), "kap", { date: "2026-08-17", exercise: "flat bench", weight_lb: 30, reps: 12 }, "mcp");
  ok("a name substring resolves to the right exercise", r.exercise && r.exercise.id === "mon_1");
  ok("the session was opened automatically", db._t.sessions.length === 1);
  ok("the row carries the derived week", db._t.sessions[0].week === 1);
  ok("prescribed sets reflect the week 1 override", r.prescribed_sets === 2);
  ok("…so one set logged leaves one remaining", r.remaining === 1);
  ok("the set is stamped with where it came from", db._t.sets[0].source === "mcp");
  ok("prescribed rest is recorded alongside", db._t.sets[0].rest_prescribed_s === 180);

  const fix = await W.swoleLogSet(env(db), "kap", { date: "2026-08-17", exercise: "mon_1", weight_lb: 30, reps: 11, set_number: 1 }, "mcp");
  ok("a correction UPSERTs rather than appending a contradictory row", db._t.sets.length === 1);
  ok("…and the value is the corrected one", db._t.sets[0].reps === 11 && fix.ok);
}

console.log("\nrefusals — the cases where guessing would corrupt the log");
{
  const db = seeded();
  const bad = await W.swoleLogSet(env(db), "kap", { date: "2026-08-17", exercise: "overhead triceps extension", weight_lb: 20, reps: 10 }, "mcp");
  ok("an exercise that is not on that day is REFUSED, not matched to the nearest thing", !!bad.error);
  ok("…and the refusal names the day's real candidates", Array.isArray(bad.candidates) && bad.candidates.length === 2);
  ok("nothing was written by the refusal", db._t.sets.length === 0);

  const low = await W.swoleLogSet(env(db), "kap", { date: "2026-08-17", exercise: "lateral raise", weight_lb: 10, reps: 10 }, "mcp");
  ok("a set under the rep range is flagged", low.below_rep_range === true);
  ok("…and the flag says to ask about the RIR cap before touching the load",
     /RIR cap/.test(low.note || "") && /opposite actions/.test(low.note || ""));
  ok("…but the load is NOT changed automatically", low.weight_lb === 10);

  const noNum = await W.swoleLogNutrition(env(db), "kap", { date: "2026-08-17", note: "hit target" }, "mcp");
  ok("nutrition with a note but no numbers still records the note", noNum.ok === true);
  const empty = await W.swoleLogNutrition(env(db), "kap", { date: "2026-08-17" }, "mcp");
  ok("…but nothing at all is refused rather than storing the target as an observation", !!empty.error);

  const unknown = await W.swoleLogMeasurement(env(db), "kap", { field: "ankle_l_in", value: 9 }, "mcp");
  ok("an unseeded measurement field is refused", !!unknown.error);
  const gap = await W.swoleLogMeasurement(env(db), "kap", { field: "waist_navel_in", value: null }, "mcp");
  ok("a null measurement is accepted as an explicit GAP", gap.ok === true && gap.value === null);
  ok("…and stored as null, not coerced to zero", db._t.measurements[0].value === null);
  const reads = await W.swoleLogMeasurement(env(db), "kap", { field: "waist_navel_in", value: 37, reads: [37.0, 37.05] }, "mcp");
  ok("raw reads are kept beside an averaged value", reads.ok && JSON.parse(db._t.measurements[1].reads).length === 2);
}

console.log("\nuid isolation — the bug that would matter most");
{
  const db = seeded();
  await W.swoleLogSet(env(db), "kap", { date: "2026-08-17", exercise: "mon_1", weight_lb: 30, reps: 12 }, "web");
  const before = STATEMENTS.length;
  const other = await W.swoleGetProgram(env(db), "someone_else");
  ok("another athlete gets no program from Kap's rows", other === null);
  const otherSess = await W.swoleSession(env(db), "someone_else", "2026-08-17");
  ok("…and cannot read Kap's session", !!otherSess.error);
  ok("every statement issued binds a uid as its first parameter",
     STATEMENTS.every(s => typeof s.bind[0] === "string" && s.bind[0].length > 0));
  const touched = STATEMENTS.slice(before);
  ok("…including the ones issued for the second athlete",
     touched.length > 0 && touched.every(s => s.bind.includes("someone_else")));
  ok("no statement issued for one athlete carries another's uid",
     !STATEMENTS.some(s => s.bind.includes("kap") && s.bind.includes("someone_else")));
}

console.log("\nthe write gate — an anonymous caller writes nothing");
{
  const sd = W.MCP_TOOLS.filter(t => t.name.startsWith("sd_"));
  ok("twelve sd_ tools are registered", sd.length === 12, sd.length + " found");
  const db = seeded();
  let refused = 0;
  for (const t of sd) {
    const r = await t.run({ field: "waist_navel_in", exercise: "mon_1", weight_lb: 30, reps: 10, sets: [], date: "2026-08-17" }, env(db), { kind: "shared" });
    const text = r.content[0].text;
    if (r.isError || /anonymous/.test(text)) refused++;
  }
  ok("every sd_ tool refuses the shared connector", refused === sd.length, refused + "/" + sd.length);
  ok("…and the shared connector wrote nothing at all",
     db._t.sets.length === 0 && db._t.sessions.length === 0 && db._t.measurements.length === 0);
  ok("the refusal points at how to get a personal URL",
     /connect\.html/.test((await sd.find(t => t.name === "sd_log_set").run({ exercise: "mon_1", weight_lb: 30, reps: 10 }, env(db), null)).content[0].text));
}

console.log("\nnutrition reads back — the write-only hole");
{
  const db = seeded();
  await W.swoleLogNutrition(env(db), "kap", { date: "2026-08-17", kcal: 2390, protein_g: 203 }, "mcp");
  const one = await W.swoleNutrition(env(db), "kap", { date: "2026-08-17" });
  ok("a logged day reads back", one.day && one.day.kcal === 2390 && one.day.protein_g === 203);
  const miss = await W.swoleNutrition(env(db), "kap", { date: "2026-08-16" });
  ok("a day with nothing logged says so rather than inventing zeros", miss.day === null);
  ok("…and does not report a 0 kcal day", !(miss.day && miss.day.kcal === 0));
  const other = await W.swoleNutrition(env(db), "someone_else", { date: "2026-08-17" });
  ok("another athlete cannot read this one's nutrition", other.day === null || !!other.error);
  const tool = W.MCP_TOOLS.find(t => t.name === "sd_nutrition");
  ok("sd_nutrition exists and is read-only", !!tool && tool.readOnlyHint === true);
  ok("the shared connector cannot read nutrition either",
     /connect\.html/.test((await tool.run({}, env(db), { kind: "shared" })).content[0].text));
}

console.log("\nannotations match what these tools actually do");
{
  const sd = W.MCP_TOOLS.filter(t => t.name.startsWith("sd_"));
  const writers = ["sd_start_session", "sd_log_set", "sd_log_sets", "sd_finish_session", "sd_log_measurement", "sd_log_nutrition"];
  ok("exactly the writers declare readOnlyHint:false",
     sd.filter(t => t.readOnlyHint === false).map(t => t.name).sort().join("|") === writers.slice().sort().join("|"));
  ok("every sd_ tool carries a title and a catalog",
     sd.every(t => typeof t.title === "string" && t.title && /^(core|full)$/.test(t.catalog)));
  ok("sd_log_set tells the model NOT to ask for confirmation first",
     /do not ask the user to confirm/i.test(sd.find(t => t.name === "sd_log_set").description));
  ok("sd_log_measurement forbids inventing a value",
     /NEVER invent a value/.test(sd.find(t => t.name === "sd_log_measurement").description));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

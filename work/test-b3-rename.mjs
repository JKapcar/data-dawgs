/* B3 — UID-keyed picks make display-name changes independent of league state. */
import { readFileSync } from "fs";
import assert from "assert";

const src = readFileSync(new URL("../dawg-bot-worker.js", import.meta.url), "utf8");
let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };

test("the legacy picksHeldBy helper is gone", () => {
  assert.ok(!src.includes("function picksHeldBy("));
  assert.ok(!src.includes("picksHeldBy(env"));
});

test("rename no longer refuses a standing leg", () => {
  assert.ok(!src.includes("Names are locked until that week is graded"));
  assert.ok(!src.includes("blockedBy: held"));
});

test("rename remains UID-only", () => {
  assert.ok(src.includes("if (!auth.uid)\n    return json({ error: \"This account predates renaming"));
});

test("rename keeps its append-only audit log", () => {
  assert.ok(src.includes('await fbPut(env, uidUserPath(auth.uid) + "/nameLog/" + at'));
});

test("rename still writes only the UID account", () => {
  assert.ok(src.includes("await fbPatch(env, uidUserPath(auth.uid), { name, nameSetAt: at })"));
});

console.log(`\n${pass} assertions passed.`);

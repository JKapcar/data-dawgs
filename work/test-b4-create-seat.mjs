/* work/test-b4-create-seat.mjs — every Bozo seat is uid-keyed, including the manager's.
 * Functions are LIFTED from the shipped worker, never re-typed.
 */
import { readFileSync } from "fs";
import assert from "assert";

const SRC = readFileSync(new URL("../dawg-bot-worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let PASS = 0;
const t  = (n, f) => { f(); PASS++; console.log("  ok  " + n); };
const ta = async (n, f) => { await f(); PASS++; console.log("  ok  " + n); };

function lift(name, kind = "async function") {
  const i = SRC.indexOf(kind + " " + name + "(");
  assert.ok(i >= 0, "cannot find " + name);
  const end = SRC.indexOf("\n}\n", i);
  assert.ok(end > i, "cannot bound " + name);
  return SRC.slice(i, end + 2);
}

const UID_K = "u_" + "k".repeat(24);
const USERS = {
  [UID_K]:            { uid: UID_K, name: "Kap", passwordHash: "h", passwordSalt: "s" },
  ["u_" + "b".repeat(24)]: { name: "BUTTS" },                       // no password yet
  "LegacyGuy":        { email: "l@e.com" },                          // name-keyed, no uid
};

/* The manager-uid resolution, lifted verbatim out of leagueCreate rather than restated. */
function resolveManagerUid(users, manager) {
  const fn = lift("leagueCreate");
  const i = fn.indexOf("let managerUid = null;");
  const j = fn.indexOf("if (!managerUid)");
  assert.ok(i > 0 && j > i, "the manager-uid resolution has moved — update this lift");
  const body = `
    const UID_RE = /^u_[A-Za-z0-9_-]{22,64}$/;
    const playerName = k => { try { return decodeURIComponent(k); } catch { return k; } };
    const accountName = (key, rec) => String((rec && rec.name) || playerName(key) || "");
  ` + fn.slice(i, j) + "return managerUid;";
  return new Function("users", "manager", body)(users, manager);
}

console.log("B4 — the manager's seat");

t("THE BUG: leagueCreate no longer seeds a name-keyed seat", () => {
  const fn = lift("leagueCreate");
  assert.ok(!/members: \{ \[encodeURIComponent\(manager\)\]: true \}/.test(fn),
    "a name-keyed manager seat in a brand-new league undoes B2 where nobody would look");
  assert.ok(fn.includes("members: { [managerUid]: { name: manager, joinedAt: Date.now() } }"));
});

t("a uid-backed manager resolves", () => {
  assert.equal(resolveManagerUid(USERS, "Kap"), UID_K);
});

t("a manager with no uid resolves to null and the route refuses", () => {
  assert.equal(resolveManagerUid(USERS, "LegacyGuy"), null);
  const fn = lift("leagueCreate");
  assert.ok(/if \(!managerUid\)[\s\S]{0,200}409/.test(fn),
    "refusing is the point — falling back to the display name is the bug being fixed");
});

t("a name that matches nothing resolves to null", () => {
  assert.equal(resolveManagerUid(USERS, "Nobody"), null);
});

t("the uid is resolved BEFORE the league object is built", () => {
  const fn = lift("leagueCreate");
  assert.ok(fn.indexOf("let managerUid = null;") < fn.indexOf("const lg = {"));
});

console.log("\nthe dormant bootstrap");

t("a bootstrapped seat carries a name label, not a bare true", () => {
  const fn = lift("loadLeagues");
  assert.ok(!/members\[key\] = true;/.test(fn),
    "uid keys with no label make memberNameAt fall back to the key — a board of raw u_ strings");
  assert.ok(fn.includes("members[key] = { name: accountName(playerName(key), rec) }"));
});

console.log("\nclaimed");

t("claimed reads the uid record's password, not just /bozoauth", () => {
  const fn = lift("bozoRoster");
  assert.ok(fn.includes("claimed: !!auth[n] || claimedBy(rec)"));
  assert.ok(!/map\(n => \(\{ name: n, claimed: !!auth\[n\] \}\)\)/.test(fn),
    "/bozoauth is empty by design after the cleanup — reading only it reports everyone unclaimed");
});

t("a uid account with a password reports claimed", () => {
  const fn = lift("bozoRoster");
  const i = fn.indexOf("const claimedBy =");
  const j = fn.indexOf("\n", i);
  const claimedBy = new Function("return " + fn.slice(i + "const claimedBy = ".length, j).replace(/;$/, ""))();
  assert.equal(claimedBy(USERS[UID_K]), true);
  assert.equal(claimedBy(USERS["u_" + "b".repeat(24)]), false, "no password yet is genuinely unclaimed");
  assert.equal(claimedBy(undefined), false);
});

console.log("\nnothing name-keyed is written anywhere in Bozo");

t("no remaining write seeds a seat by display name", () => {
  assert.ok(!/\/members", \{ \[encodeURIComponent\(/.test(SRC));
  assert.ok(!/members: \{ \[encodeURIComponent\(/.test(SRC));
  assert.ok(!/picks\/" \+ encodeURIComponent\(name\)/.test(SRC));
});

t("B2 and B3 are still in place", () => {
  assert.ok(SRC.includes("function memberKeyOf"), "B2's resolver");
  assert.ok(SRC.includes('/members/" + key, { name: String(name || "") }'), "B2's label self-heal");
  assert.ok(!/picksHeldBy/.test(SRC), "B3 removed the rename guard");
});

console.log("\n" + PASS + " assertions passed.");

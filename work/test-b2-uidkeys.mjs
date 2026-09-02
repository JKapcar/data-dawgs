/* work/test-b2-uidkeys.mjs — Bozo league state keyed by uid.
 *
 * ⚠️ Functions are LIFTED out of the shipped files, never re-typed. A fixture that
 * supplies the field under test is how a green suite ships a bug.
 */
import { readFileSync } from "fs";
import assert from "assert";

const root = new URL("../", import.meta.url);
const SRC   = readFileSync(new URL("dawg-bot-worker.js", root), "utf8").replace(/\r\n/g, "\n");
const BLOCK = readFileSync(new URL("work/mcp-block.js", root), "utf8").replace(/\r\n/g, "\n");

let PASS = 0;
const t  = (n, f) => { f(); PASS++; console.log("  ok  " + n); };
const ta = async (n, f) => { await f(); PASS++; console.log("  ok  " + n); };

function liftFrom(src, name, kind = "function") {
  const head = kind + " " + name + "(";
  const i = src.indexOf(head);
  assert.ok(i >= 0, "cannot find " + name);
  const end = src.indexOf("\n}\n", i);
  assert.ok(end > i, "cannot bound " + name);
  return src.slice(i, end + 2);
}
/* ⚠️ Brace-balanced, not regex. A lazy `;$` match truncates a multi-line arrow at the
   first inner statement and silently lifts half a function. */
function liftConstFrom(src, name) {
  const re = new RegExp("^const " + name + " = ", "m");
  const m = re.exec(src);
  assert.ok(m, "cannot find const " + name);
  let i = m.index, depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(i, j + 1);
  }
  assert.fail("cannot bound const " + name);
}

const api = (() => {
  const body = `
    const UID_RE = /^u_[A-Za-z0-9_-]{22,64}$/;
    const playerName = k => { try { return decodeURIComponent(k); } catch { return k; } };
  `
    + liftConstFrom(SRC, "memberRec") + "\n"
    + liftConstFrom(SRC, "memberNameAt") + "\n"
    + liftConstFrom(SRC, "memberKeys") + "\n"
    + liftConstFrom(SRC, "memberNames") + "\n"
    + liftFrom(SRC, "memberKeyOf") + "\n"
    + liftConstFrom(SRC, "isMember") + "\n";
  return new Function(body + "return { memberNameAt, memberKeys, memberNames, memberKeyOf, isMember };")();
})();

const UID_K = "u_" + "k".repeat(24);
const UID_T = "u_" + "t".repeat(24);
const NEW = { members: { [UID_K]: { name: "Kap", joinedAt: 1 },
                         [UID_T]: { name: "The Kid", joinedAt: 2 } } };
const LEGACY = { members: { "Kap": true, "The%20Kid": true } };   // a demo league

console.log("member keys");

t("names come from the label, not the key", () => {
  assert.deepEqual(api.memberNames(NEW).sort(), ["Kap", "The Kid"]);
});
t("a legacy name-keyed league still renders", () => {
  assert.deepEqual(api.memberNames(LEGACY).sort(), ["Kap", "The Kid"]);
});
t("a uid session resolves to its own seat", () => {
  assert.equal(api.memberKeyOf(NEW, { uid: UID_T, name: "The Kid" }), UID_T);
});
t("THE POINT: a renamed member keeps the same key", () => {
  const renamed = { members: { [UID_T]: { name: "TheKidV2" } } };
  assert.equal(api.memberKeyOf(renamed, { uid: UID_T, name: "TheKidV2" }), UID_T,
    "a rename must not move the seat — that is the entire reason for this commit");
  assert.equal(api.memberNames(renamed)[0], "TheKidV2");
});
t("a non-member resolves to null, never to a fabricated key", () => {
  assert.equal(api.memberKeyOf(NEW, { uid: "u_" + "z".repeat(24), name: "Nobody" }), null,
    "returning encodeURIComponent(name) here would hand a stranger a seat and undo the re-key");
});
t("a uid session whose seat is legacy-keyed still resolves by name", () => {
  assert.equal(api.memberKeyOf(LEGACY, { uid: UID_K, name: "Kap" }), "Kap");
});
t("a name with a space resolves through the encoded legacy key", () => {
  assert.equal(api.memberKeyOf(LEGACY, { name: "The Kid" }), "The%20Kid");
});
t("isMember matches the label, not just the key", () => {
  assert.equal(api.isMember(NEW, "The Kid"), true);
  assert.equal(api.isMember(NEW, "Nobody"), false);
});
t("a member row that is `true` does not crash the label reader", () => {
  assert.equal(api.memberNameAt(LEGACY, "Kap"), "Kap");
});

console.log("\nwrites — source assertions");

t("a seat REQUIRES a uid and refuses rather than falling back", () => {
  const fn = liftFrom(SRC, "leagueJoin", "async function");
  assert.ok(/if \(!auth\.uid \|\| !UID_RE\.test\(String\(auth\.uid\)\)\)/.test(fn));
  assert.ok(fn.includes("{ [auth.uid]: { name: auth.name, joinedAt: Date.now() } }"));
  assert.ok(!/\{ \[encodeURIComponent\(auth\.name\)\]: true \}/.test(fn),
    "one name-keyed fallback undoes the whole commit");
});
t("a leg is written under the member key and carries `who`", () => {
  const fn = liftFrom(SRC, "commitBozoLeg", "async function");
  assert.ok(fn.includes('await fbPut(env, LG(lid) + "/picks/" + key, pick);'));
  assert.ok(/who: String\(name \|\| ""\)/.test(fn));
  assert.ok(!/picks\/" \+ encodeURIComponent\(name\)/.test(fn));
});
t("commitBozoLeg refuses a caller it cannot resolve", () => {
  const fn = liftFrom(SRC, "commitBozoLeg", "async function");
  assert.ok(fn.includes('if (!key) return { ok: false, error: "You are not in this league." };'));
});
t("no bozo league write anywhere keys on a display name", () => {
  for (const [nm, s] of [["worker", SRC], ["mcp-block", BLOCK]]) {
    assert.ok(!/picks\/" \+ encodeURIComponent\(name\)/.test(s), nm + " writes a name-keyed pick");
    assert.ok(!/\/members", \{ \[encodeURIComponent\(/.test(s), nm + " writes a name-keyed seat");
  }
});

console.log("\nreceipts");

t("a ledger row names the submitter from the leg", () => {
  const fn = liftFrom(SRC, "ledgerEntries");
  assert.ok(fn.includes("player: x.who || playerName(n)"),
    "a receipt that resolved names through the members map goes blank when someone leaves");
});
t("the royale fallback chop names a person, not a key", () => {
  assert.ok(SRC.includes("out.chopped = (picks[first] && picks[first].who) || playerName(first);"));
});

console.log("\nMCP surfaces agree with the site");

t("dd_bozo_week renders `who`", () => {
  assert.ok(BLOCK.includes("order: i + 1, player: x.who || playerName(k),"));
  assert.ok(BLOCK.includes("you: me ? (x.who || playerName(k)) === me : undefined,"));
});
t("both waiting lists map keys to labels", () => {
  const hits = BLOCK.match(/stillWaitingOn: memberKeys\(lg\)\.filter\(k => !picks\[k\]\)/g) || [];
  assert.equal(hits.length, 2, "propose and week must agree; a split reports different boards");
});
t("the MCP submit resolves ONE key and reuses it for every check and the write", () => {
  assert.ok(BLOCK.includes("const mkey = memberKeyOf(lg, caller);"));
  assert.ok(BLOCK.includes("if (!set.allowEdit && picks[mkey])"));
  assert.ok(BLOCK.includes("if (set.format === \"royale\" && !royaleAliveKey(lg, mkey))"));
  assert.ok(BLOCK.includes('commitBozoLeg(env, lid, lg, name, pend.p, "mcp", mkey)'),
    "the write must land under the key the checks used, or MCP and the site disagree");
});
t("no MCP surface still finds a leg by encoded display name", () => {
  assert.ok(!/picks\[encodeURIComponent\(name\)\]/.test(BLOCK));
});

console.log("\nthe generated half is not hand-edited");
t("the MCP block in the worker matches work/mcp-block.js", () => {
  const START = "/* ===== DD-MCP-BLOCK START";
  assert.ok(SRC.indexOf(START) > 0, "worker has no MCP block markers");
  const probes = [
    "const mkey = memberKeyOf(lg, caller);",
    "order: i + 1, player: x.who || playerName(k),",
  ];
  for (const p of probes)
    assert.ok(SRC.includes(p),
      "assemble.mjs has not been run — the worker's generated half is stale: " + p);
});



console.log("\nthe board page translates names to keys");
{
  const PAGE = readFileSync(new URL("bozo.html", root), "utf8").replace(/\r\n/g, "\n");
  const page = (() => {
    const grab = n => {
      const re = new RegExp("^const " + n + " = ", "m");
      const m = re.exec(PAGE);
      assert.ok(m, "cannot find const " + n + " in bozo.html");
      let depth = 0;
      for (let j = m.index; j < PAGE.length; j++) {
        const c = PAGE[j];
        if ("{([".includes(c)) depth++;
        else if ("})]".includes(c)) depth--;
        else if (c === ";" && depth === 0) return PAGE.slice(m.index, j + 1);
      }
      assert.fail("cannot bound " + n);
    };
    const body = "let S = {};\n" + grab("kDec") + "\n" + grab("memberLabel") + "\n"
               + grab("stateMembers") + "\n" + grab("kEnc") + "\n";
    const f = new Function(body + "return { set: s => { S = s; }, memberLabel, stateMembers, kEnc };");
    return f();
  })();

  const U = "u_" + "k".repeat(24), U2 = "u_" + "t".repeat(24);

  t("a uid-keyed board resolves a name to its uid", () => {
    page.set({ members: { [U]: { name: "Kap" }, [U2]: { name: "The Kid" } }, picks: { [U2]: { ts: 1 } } });
    assert.equal(page.kEnc("The Kid"), U2);
    assert.equal(page.kEnc("Kap"), U);
    assert.deepEqual(page.stateMembers().sort(), ["Kap", "The Kid"]);
  });

  t("REGRESSION: a legacy demo league still paints", () => {
    page.set({ members: { "Kap": true, "The%20Kid": true }, picks: { "The%20Kid": { ts: 1 } } });
    assert.equal(page.kEnc("The Kid"), "The%20Kid",
      "the two DEMO leagues are graded history and are never migrated — a uid-only board shows them empty");
    assert.deepEqual(page.stateMembers().sort(), ["Kap", "The Kid"]);
  });

  t("a name that is already a data key passes through", () => {
    page.set({ members: {}, picks: { "Squatch": { ts: 1 } } });
    assert.equal(page.kEnc("Squatch"), "Squatch");
  });

  t("a renamed member resolves under the new label, same key", () => {
    page.set({ members: { [U2]: { name: "TheKidV2" } }, picks: { [U2]: { ts: 1 } } });
    assert.equal(page.kEnc("TheKidV2"), U2);
    assert.equal(page.stateMembers()[0], "TheKidV2");
  });

  t("a stranger falls back to the encoded name and finds nothing", () => {
    page.set({ members: { [U]: { name: "Kap" } }, picks: { [U]: { ts: 1 } } });
    assert.equal(page.kEnc("Nobody"), "Nobody");
    assert.equal(({ [U]: { ts: 1 } })[page.kEnc("Nobody")], undefined);
  });

  t("the label self-heals on submit, so a rename is never permanently stale", () => {
    const fn = liftFrom(SRC, "commitBozoLeg", "async function");
    assert.ok(fn.includes('LG(lid) + "/members/" + key, { name: String(name || "") }'),
      "/auth/rename does not know which leagues someone is in; without this the board keeps the old name");
  });
}

console.log("\n" + PASS + " assertions passed.");

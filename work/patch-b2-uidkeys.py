#!/usr/bin/env python3
"""
Commit B2 — Bozo league state keyed by immutable UID.

Idempotent, anchor-based. Run from repo root:  python3 work/patch-b2-uidkeys.py

WHY THIS IS SMALL
-----------------
It is small ONLY because it ships immediately before the roster wipe. `main`'s Week 1
board is open and unplaced, so there is nothing to migrate and nothing to dual-read: the
members map and the picks map are both about to be emptied, and every member re-joins
under the new key by signing in. Applied to a populated league this patch would be a
breaking change; applied to an empty one it is just the new shape.

⚠️ ORDER IS THE WHOLE COMMIT. Ship this, THEN wipe, THEN let people re-join. Wiping
first and shipping after means everyone re-joins under a display name and the migration
has to be done again for real.

WHAT CHANGES
------------
  members:  { "The%20Kid": true }  ->  { "u_...": { name: "The Kid", joinedAt: 0 } }
  picks:    { "The%20Kid": {...} } ->  { "u_...": { ..., who: "The Kid" } }

The member key becomes the uid. The DISPLAY NAME is carried as a label on the member row
and as `who` on each pick, so a rename changes what every surface shows without moving a
single key -- which is the entire point of the exercise.

⚠️ `who` IS WRITTEN ONTO THE PICK, not looked up at render time. Ledger rows are
immutable receipts and outlive league membership: a row that resolved its name through
the members map would start rendering a bare uid the day someone left the league.
"""
import sys, io

TARGET = "dawg-bot-worker.js"
src = io.open(TARGET, encoding="utf8").read()
orig = src

def sub(old, new, label):
    """⚠️ THE APPLIED-CHECK IS `anchor gone`, NOT `replacement present`.
    Two different sites in this file get byte-identical replacement text. Guarding on
    `new in src` made the second one report "already applied" and silently skip -- a
    patch that lies about having run is worse than one that crashes."""
    global src
    if old not in src:
        if new in src:
            print("  = %s already applied" % label); return
        sys.exit("FAIL: anchor not found for %s" % label)
    n = src.count(old)
    if n != 1:
        sys.exit("FAIL: anchor matched %d times for %s" % (n, label))
    src = src.replace(old, new, 1)
    print("  + %s" % label)

# ------------------------------------------------------------------ 1. helpers
sub('''const memberNames = lg => Object.keys((lg && lg.members) || {}).map(playerName);
const isMember = (lg, name) =>
  !!((lg && lg.members) || {})[encodeURIComponent(name)] || !!((lg && lg.members) || {})[name];''',
'''/* ===== member keys =====
   A member row is keyed by the joiner's immutable uid and carries their display name as
   a mutable label. Everything that used to key on the name now keys on the uid and reads
   the label for display. The legacy shapes -- `true` as the value, or the name itself as
   the key -- are still READ so the demo leagues and any imported season keep rendering;
   nothing WRITES them any more. */
const memberRec = (lg, key) => ((lg && lg.members) || {})[key];
const memberNameAt = (lg, key) => {
  const v = memberRec(lg, key);
  return (v && typeof v === "object" && v.name) ? String(v.name) : playerName(key);
};
const memberKeys = lg => Object.keys((lg && lg.members) || {});
const memberNames = lg => memberKeys(lg).map(k => memberNameAt(lg, k));

/* The one resolver. Returns the map key for whoever is asking, or null if they are not
   in this league. Prefers the uid; falls back to the legacy name shapes so a demo league
   still resolves. ⚠️ Never invent a key from auth.name -- a miss must be null, or a
   non-member silently gets a seat under a name-shaped key and the re-key is undone. */
function memberKeyOf(lg, auth) {
  const ms = (lg && lg.members) || {};
  const has = k => k != null && Object.prototype.hasOwnProperty.call(ms, k);
  if (auth && auth.uid && has(auth.uid)) return auth.uid;
  const n = auth && auth.name;
  if (n == null) return null;
  if (has(encodeURIComponent(n))) return encodeURIComponent(n);
  if (has(n)) return n;
  for (const k of Object.keys(ms)) if (memberNameAt(lg, k) === n) return k;
  return null;
}
const isMember = (lg, name) => memberKeyOf(lg, { name }) !== null;''',
    "helpers — memberKeyOf / memberNameAt / memberNames")

# ------------------------------------------------------------------ 2. join writes uid
sub('''  try {
    await fbPatch(env, LG(lid) + "/members", { [encodeURIComponent(auth.name)]: true });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }''',
'''  // ⚠️ A UID IS REQUIRED TO TAKE A SEAT, and the refusal is deliberate rather than a
  // fallback to the display name. Falling back is exactly how the mutable key got into
  // league state in the first place; one legacy session would silently undo this commit.
  if (!auth.uid || !UID_RE.test(String(auth.uid)))
    return json({ error: "Your sign-in predates the current account system. Create an account on the sign-on page, then join." }, 409, cors);

  try {
    await fbPatch(env, LG(lid) + "/members",
                  { [auth.uid]: { name: auth.name, joinedAt: Date.now() } });
  } catch (e) { return json({ error: "Database write failed: " + e.message }, 502, cors); }''',
    "leagueJoin — seat is keyed by uid, name is a label")

# ------------------------------------------------------------------ 3. commitBozoLeg
sub('''async function commitBozoLeg(env, lid, state, name, p, via = null) {
  const set = settingsOf(state);''',
'''async function commitBozoLeg(env, lid, state, name, p, via = null, mkey = null) {
  const set = settingsOf(state);
  // The caller has already resolved membership; this is the key that resolution produced.
  // Refusing a null key rather than falling back to the name keeps one code path.
  const key = mkey || memberKeyOf(state, { name });
  if (!key) return { ok: false, error: "You are not in this league." };''',
    "commitBozoLeg — takes the member key")

sub('''    ts: Date.now(),                 // SERVER time — the reason this route exists
  };
  await fbPut(env, LG(lid) + "/picks/" + encodeURIComponent(name), pick);''',
'''    // ⚠️ The display name AT SUBMISSION TIME, stored on the leg itself. Ledger rows are
    // immutable receipts that outlive membership: resolving the name through the members
    // map at render time would turn every row for a departed member into a bare uid.
    // A later rename changes the live board and leaves settled receipts alone, which is
    // the correct behaviour for a receipt.
    who: String(name || ""),
    ts: Date.now(),                 // SERVER time — the reason this route exists
  };
  await fbPut(env, LG(lid) + "/picks/" + key, pick);''',
    "commitBozoLeg — pick carries `who`, writes under the key")

# ------------------------------------------------------------------ 3b. label refresh
sub("""  await fbPut(env, LG(lid) + "/picks/" + key, pick);

  const picks = (await fbGet(env, LG(lid) + "/picks")).data || {};""",
    """  await fbPut(env, LG(lid) + "/picks/" + key, pick);

  // ⚠️ THE LABEL IS REFRESHED ON EVERY SUBMISSION, and this is what keeps a rename from
  // going stale. /auth/rename writes the new name to /users/<uid> and knows nothing about
  // which leagues that person sits in; without this line the board would keep showing the
  // old name until they re-joined. Filing a leg re-stamps it, so a rename is visible from
  // the next submission and no cross-league name index has to exist.
  try { await fbPatch(env, LG(lid) + "/members/" + key, { name: String(name || "") }); }
  catch { /* the leg is the write that matters; a stale label is cosmetic and self-heals */ }

  const picks = (await fbGet(env, LG(lid) + "/picks")).data || {};""",
    "commitBozoLeg — the members label self-heals on submit")

# ------------------------------------------------------------------ 4. bozoPick
sub('''  try {
    if (body.action === "remove") {
      await fbDelete(env, LG(lid) + "/picks/" + encodeURIComponent(name));
      return json({ ok: true, removed: true }, 200, cors);
    }''',
'''  const mkey = memberKeyOf(state, auth);
  if (!mkey) return json({ error: "You are not in this league." }, 403, cors);

  try {
    if (body.action === "remove") {
      await fbDelete(env, LG(lid) + "/picks/" + mkey);
      return json({ ok: true, removed: true }, 200, cors);
    }''',
    "bozoPick — resolve the member key once")

sub('''    if (!set.allowEdit && (state.picks || {})[encodeURIComponent(name)])
      return json({ error: "This league locks your leg once it's in — no edits." }, 409, cors);''',
'''    if (!set.allowEdit && (state.picks || {})[mkey])
      return json({ error: "This league locks your leg once it's in — no edits." }, 409, cors);''',
    "bozoPick — allowEdit reads the key")

sub('''    if (set.format === "royale" && !royaleAlive(state, name))
      return json({ error: "You're out — chopped in week " + (royaleStatus(state)[encodeURIComponent(name)]?.chopped?.slice(-1)[0] ?? "?") + ". You fund this ticket; you don't have a leg on it." }, 409, cors);

    const p = body.pick || {};
    const err = validatePick(p, name, state.picks || {}, bandOf(state), set.format);
    if (err) return json({ error: err }, 400, cors);

    const out = await commitBozoLeg(env, lid, state, name, p);''',
'''    if (set.format === "royale" && !royaleAliveKey(state, mkey))
      return json({ error: "You're out — chopped in week " + (royaleStatus(state)[mkey]?.chopped?.slice(-1)[0] ?? "?") + ". You fund this ticket; you don't have a leg on it." }, 409, cors);

    const p = body.pick || {};
    const err = validatePick(p, name, state.picks || {}, bandOf(state), set.format, mkey);
    if (err) return json({ error: err }, 400, cors);

    const out = await commitBozoLeg(env, lid, state, name, p, null, mkey);''',
    "bozoPick — royale + validate + commit take the key")

# ------------------------------------------------------------------ 5. validatePick
sub("function validatePick(p, name, existing, band, format) {",
    "function validatePick(p, name, existing, band, format, mkey = null) {",
    "validatePick — accepts the member key")

# ------------------------------------------------------------------ 5. validatePick self-exclusion
sub('''  const meKey = encodeURIComponent(name), meName = playerName(name);
  const mySel = selectionKeyOf(p), myMkt = marketKeyOf(p);

  for (const [who, x] of Object.entries(existing)) {
    if (!x) continue;
    if (who === meKey || who === meName || playerName(who) === meName) continue;  // my own leg, being edited''',
'''  const meKey = mkey || encodeURIComponent(name), meName = playerName(name);
  const mySel = selectionKeyOf(p), myMkt = marketKeyOf(p);

  for (const [who, x] of Object.entries(existing)) {
    if (!x) continue;
    // ⚠️ The key comparison is what excludes MY OWN leg while I edit it. The name
    // comparisons stay as a belt for legacy/demo maps whose keys are still names.
    if (who === meKey || who === meName || (x.who || playerName(who)) === meName) continue;''',
    "validatePick — self-exclusion by key")

sub('''      return `${playerName(who)} already has that exact selection''',
'''      return `${x.who || playerName(who)} already has that exact selection''',
    "validatePick — duplicate message names the person")
sub('''      return `${playerName(who)} has the other side''',
'''      return `${x.who || playerName(who)} has the other side''',
    "validatePick — contradiction message names the person")

# ------------------------------------------------------------------ 6. royaleAlive
sub('''const royaleAlive = (state, name) => {
  const st = royaleStatus(state)[encodeURIComponent(name)];
  return !st || st.alive !== false;
};''',
'''const royaleAliveKey = (state, key) => {
  const st = royaleStatus(state)[key];
  return !st || st.alive !== false;
};
const royaleAlive = (state, name) => royaleAliveKey(state, memberKeyOf(state, { name }));''',
    "royaleAliveKey — status is read by member key")

# ------------------------------------------------------------------ 7. ledger + render
sub('''      season, week, player: playerName(n),''',
'''      season, week, player: x.who || playerName(n),''',
    "ledgerEntries — receipt carries the submitted name")

sub('''  out.chopped = playerName(first); out.choppedKey = first;''',
'''  out.chopped = (picks[first] && picks[first].who) || playerName(first); out.choppedKey = first;''',
    "royale fallback — chop names the person, not the key")

sub('''  return json({ ok: true, placed, legs: n, waitingOn: memberNames(lg).filter(p => !picks[encodeURIComponent(p)]) }, 200, cors);''',
'''  return json({ ok: true, placed, legs: n,
                waitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)) }, 200, cors);''',
    "leagueLock — waitingOn maps keys to names")

# ------------------------------------------------------------------ 8. leagueMember removal
sub('''  if ((lg.picks || {})[encodeURIComponent(player)])
    return json({ error: player + " already has a leg in this week. Remove the leg first." }, 409, cors);
  if (lg.manager === player)
    return json({ error: "The manager can't leave their own league." }, 400, cors);

  try {
    await fbPatch(env, LG(lid) + "/members", { [encodeURIComponent(player)]: null });''',
'''  // Resolve the seat by NAME here on purpose: this route's caller is a manager naming
  // somebody, not the member themselves, so there is no uid in hand.
  const pkey = memberKeyOf(lg, { name: player });
  if (!pkey) return json({ error: player + " is not in this league." }, 404, cors);
  if ((lg.picks || {})[pkey])
    return json({ error: player + " already has a leg in this week. Remove the leg first." }, 409, cors);
  if (lg.manager === player)
    return json({ error: "The manager can't leave their own league." }, 400, cors);

  try {
    await fbPatch(env, LG(lid) + "/members", { [pkey]: null });''',
    "leagueMember — removal resolves the seat")

if src == orig:
    print("no change (already applied)")
else:
    io.open(TARGET, "w", encoding="utf8").write(src)
    print("wrote %s" % TARGET)

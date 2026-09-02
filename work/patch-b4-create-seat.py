#!/usr/bin/env python3
"""
Commit B4 — the last two name-keyed seats, and the `claimed` regression.

Idempotent, anchor-based. Run from repo root:  python3 work/patch-b4-create-seat.py

⚠️ SHIP THIS BEFORE CREATING BOZO BOYZ ROYALE.

B2 re-keyed `leagueJoin` but NOT `leagueCreate`, which still seeds the manager's own seat
as `{ [encodeURIComponent(manager)]: true }`. Creating a league today would plant a
name-keyed seat in a brand-new league on day one -- reintroducing, in the one place
nobody would think to look, exactly what the wipe just removed. Every member who joined
afterwards would be uid-keyed and the manager would not, which is worse than either
shape on its own.

Also fixes `claimed`, which the account cleanup broke: it reads `/bozoauth`, and that node
is now empty by design because uid accounts carry their password on the user record.
"""
import sys, io

TARGET = "dawg-bot-worker.js"
src = io.open(TARGET, encoding="utf8").read()
orig = src

def sub(old, new, label):
    """⚠️ THE APPLIED-CHECK IS A SENTINEL, and it took three tries in this codebase to get
    right. `new in src` false-positives when two sites share replacement text. `old not in
    src` false-negatives when the replacement RE-EMITS its own anchor (an insertion that
    keeps the anchor as its prefix) -- which silently double-applies the block.
    The only thing that works for both is: pick the first line of the replacement that
    does not occur in the anchor, and treat its presence as proof the patch ran."""
    global src
    sentinel = next((ln.strip() for ln in new.split("\n")
                     if ln.strip() and ln.strip() not in old), None)
    if sentinel is None:
        sys.exit("FAIL: no sentinel distinguishes the replacement for %s" % label)
    if sentinel in src:
        print("  = %s already applied" % label); return
    if old not in src:
        sys.exit("FAIL: anchor not found for %s" % label)
    if src.count(old) != 1:
        sys.exit("FAIL: anchor matched %d times for %s" % (src.count(old), label))
    src = src.replace(old, new, 1)
    print("  + %s" % label)

# ---------------------------------------------------------------- 1. the manager's seat
sub('''  const manager = String(body.manager || auth.name);
  const users = await loadUsers(env);
  if (!userNames(users).includes(manager))
    return json({ error: manager + " doesn't have an account yet — invite them first." }, 400, cors);''',
'''  const manager = String(body.manager || auth.name);
  const users = await loadUsers(env);
  if (!userNames(users).includes(manager))
    return json({ error: manager + " doesn't have an account yet — invite them first." }, 400, cors);

  // ⚠️ THE MANAGER'S SEAT IS KEYED BY UID LIKE EVERY OTHER SEAT. The manager is named by
  // display name in the request body (an admin naming a person), so their uid has to be
  // resolved out of /users. Refusing when it cannot be is deliberate: seeding a
  // name-keyed seat here would put the one shape this codebase no longer writes into a
  // brand-new league, where every member joining after them is uid-keyed and only the
  // manager is not.
  let managerUid = null;
  for (const [key, rec] of Object.entries(users)) {
    const k = playerName(key);
    if (UID_RE.test(k) && accountName(k, rec) === manager) { managerUid = k; break; }
  }
  if (!managerUid)
    return json({ error: manager + " has no account id yet — they need to sign in once before they can manage a league." }, 409, cors);''',
    "leagueCreate — resolve the manager's uid")

sub('''    members: { [encodeURIComponent(manager)]: true },''',
'''    members: { [managerUid]: { name: manager, joinedAt: Date.now() } },''',
    "leagueCreate — seat the manager by uid")

# ---------------------------------------------------------------- 2. the dormant bootstrap
sub('''  const users = await loadUsers(env);
  const members = {};
  for (const key of Object.keys(users)) members[key] = true;''',
'''  const users = await loadUsers(env);
  const members = {};
  // ⚠️ DORMANT BUT NOT HARMLESS. This only fires when /bozo/leagues is entirely empty,
  // which it is not. It is fixed anyway because /users is now uid-keyed: seeding
  // `members[uid] = true` would give every seat a uid key with NO name label, and
  // memberNameAt would fall back to the key -- a board rendering raw u_ strings, from a
  // path nobody would think to look at because it normally never runs.
  for (const [key, rec] of Object.entries(users)) members[key] = { name: accountName(playerName(key), rec) };''',
    "loadLeagues bootstrap — seeded seats carry a name label")

# ---------------------------------------------------------------- 3. claimed
sub('''  const players = userNames(users).map(n => ({ name: n, claimed: !!auth[n] }));''',
'''  // ⚠️ /bozoauth IS EMPTY NOW, BY DESIGN. Legacy accounts kept their password hash there;
  // uid accounts carry it on the user record. Reading only /bozoauth reports every
  // account as unclaimed -- which empties the sign-in autocomplete and makes the manager
  // view label people who plainly have passwords as "not claimed yet".
  const claimedBy = rec => !!(rec && rec.passwordHash && rec.passwordSalt);
  const players = Object.entries(users).map(([key, rec]) => {
    const n = accountName(playerName(key), rec);
    return { name: n, claimed: !!auth[n] || claimedBy(rec) };
  });''',
    "bozoRoster — claimed also reads the uid record's password")

if src == orig:
    print("no change (already applied)")
else:
    io.open(TARGET, "w", encoding="utf8").write(src)
    print("wrote %s" % TARGET)

# SwoleDawg v0.4.0 — Technical Spec

## 1. Why a worker

Claude in a chat window cannot write to a static site. It has no filesystem there, no FTP, no
git. The only way it can push data is by calling a tool over MCP. So the write path has to
terminate in a server Claude can reach.

Options considered and rejected:

- **GitHub MCP → commit JSON → rebuild.** Works, but every logged set becomes a commit and a
  30–90 second deploy. Unusable mid-workout.
- **Airtable MCP as the store.** Already connected, but the site would need an API key in
  client JS to read it back. Non-starter.
- **Cloudflare Worker + D1.** Claude writes over MCP, the site reads over HTTPS, both hit the
  same database, latency is sub-second, and Kap already operates this exact stack for the
  Data Dawgs MCP server.

Third option. The rest of this spec assumes it.

```
  Claude (phone, voice)  ──MCP──►  ┌─────────────────┐
                                    │  Worker + D1    │
  swoledawg.html         ──GET──►  └─────────────────┘
  (browser)              ──POST─►   (logger UI writes here too)
```

The browser logger and Claude write through the same endpoints. There is one source of truth
and no sync problem. If Kap logs three sets by tapping and two by talking, they land in the
same table.

---

## 2. Storage — D1

Not KV. Sets need to be queried by exercise across time (`what did I bench three weeks ago`,
`has anything hit top-of-range twice`) and that is a SQL question.

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,        -- '2026-08-18-lower'
  date          TEXT NOT NULL,           -- ISO date
  day_key       TEXT NOT NULL,           -- monday|tuesday|wednesday|thursday|friday|saturday
  session_type  TEXT NOT NULL,           -- 'lift' | 'ruck' | 'rest'
  block         INTEGER NOT NULL DEFAULT 1,
  week          INTEGER NOT NULL,       -- derived at write time, then frozen; see Week derivation
  started_at    TEXT,
  completed_at  TEXT,
  notes         TEXT
);

CREATE TABLE sets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         TEXT NOT NULL REFERENCES sessions(id),
  exercise_id        TEXT NOT NULL,      -- 'mon_1'
  exercise_name      TEXT NOT NULL,      -- denormalized; program names may change
  set_number         INTEGER NOT NULL,
  weight_lb          REAL,
  reps               INTEGER,
  rir                INTEGER,
  rest_prescribed_s  INTEGER,
  rest_taken_s       INTEGER,
  source             TEXT NOT NULL,      -- 'claude' | 'web'
  logged_at          TEXT NOT NULL,
  UNIQUE(session_id, exercise_id, set_number)
);

CREATE TABLE rucks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  duration_min INTEGER,
  incline_pct  REAL,
  speed_mph    REAL,
  load_lb      REAL,
  surface      TEXT,               -- 'treadmill' | 'flat_ground'
  notes        TEXT,
  logged_at    TEXT NOT NULL
);

-- Long format, not wide. 25+ fields on different cadences; a wide table
-- would be mostly NULL and would need a migration every time a field is added.
CREATE TABLE measurements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  field      TEXT NOT NULL,        -- 'waist_navel_in', 'arm_flexed_r_in', ...
  value      REAL,
  reads      TEXT,                 -- JSON array of raw reads before averaging
  source     TEXT NOT NULL,        -- 'claude' | 'web'
  notes      TEXT,
  UNIQUE(date, field)
);

CREATE TABLE measurement_fields (
  field             TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  unit              TEXT NOT NULL,
  tier              INTEGER NOT NULL,   -- 1 core, 2 goal, 3 drift, 4 safety
  tag               TEXT NOT NULL,      -- OBSERVED | DERIVED | MODELLED | PLAN
  cadence           TEXT NOT NULL,
  site              TEXT NOT NULL,
  baseline          REAL,
  target_low        REAL,
  target_high       REAL,
  desired_direction TEXT NOT NULL,      -- 'up' | 'down' | 'flat'
  safety_instrument INTEGER DEFAULT 0,
  immutable_site    INTEGER DEFAULT 0
);

CREATE TABLE nutrition (
  date       TEXT PRIMARY KEY,
  kcal       INTEGER,
  protein_g  INTEGER
);

CREATE TABLE program (
  version    INTEGER PRIMARY KEY,
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 2a. Measurement rules the schema exists to enforce

These come from `measurements-final.pdf` and are not stylistic preferences — each one
describes a way the dataset gets corrupted if the app is naive.

- **`desired_direction` is mandatory and display logic must key off it, never off the sign of
  the delta.** Weight, both waist fields, hips, and body fat are all supposed to fall. A UI
  that paints any decrease red will report failure for six months during the exact window the
  plan is working.
- **`waist_navel_in` has `immutable_site = 1`.** It is the Navy formula input. If the site
  ever moves, the entire body-fat history becomes uninterpretable retroactively.
  `waist_narrow_in` is a separate field and always will be.
- **`bf_true_pct` is MODELLED with a ±3 point band and must render visibly differently from
  `navy_bf_pct`.** Different type treatment, explicit band, not just a tooltip. Rendered as a
  plain number next to a measured one it will be treated as measured inside a month.
- **Neck confounds the headline.** Every 0.25 in of neck gain drops `navy_bf_pct` about 0.4
  points with zero fat lost, and this program thickens necks. Compute a `bf_waist_only`
  variant holding neck at the 15.5 baseline and annotate the body-fat chart at every session
  where neck moved.
- **`calf_asym` carries `expected_asymmetry: 1.0`.** The gap is surgical and permanent. Do not
  render it as an unresolved imbalance with a target of zero.
- **`forearm_in` is the calibration anchor.** It barely responds to this program. If a session
  shows over 0.5 in of movement, flag tape technique for that whole session rather than
  believing any of it.
- **Never mix a width into a circumference column.** Wall-mark shoulder width, if ever taken,
  goes in `shoulder_width_in`.

### 2b. Ankle fields are a safety instrument

`ankle_l_in` and `ankle_r_in` get their own panel with **no progress framing, no target, no
improvement colouring**. They are an instrument.

The hard stop is a blocking check, not a note in a paragraph:

> Right ankle more than 0.5 in larger than left, **or** rising two weeks running, **or** any
> ankle ache and stiffness → suspend rucking and contact the surgeon.

Implement this as a computed flag the worker returns on `/api/summary` and on every ruck-
related MCP tool. When it trips, `sd_log_ruck` refuses and returns the reason, and the ruck
prescription on the site is replaced with the stop notice. Do not make this dismissible.

**Notes that matter:**

- `UNIQUE(session_id, exercise_id, set_number)` makes `sd_log_set` idempotent via UPSERT. If
  Kap says "actually that was 11 not 10," the correction overwrites rather than duplicating.
  Voice logging produces corrections constantly — design for it.
- `rest_prescribed_s` and `rest_taken_s` are **both** stored. Never overwrite one with the
  other. The gap between them is the diagnostic when a lift stalls.
- `source` distinguishes talked-in from tapped-in sets. Useful later for spotting whether
  voice logs are less accurate.
- `exercise_name` is denormalized deliberately. When the program changes in six months,
  historical rows should still say what they said.
- Seed `program.json` as version 1.

---

## 3. Worker — MCP surface

Mount at `/mcp/{token}` mirroring the Data Dawgs worker. Token in path, not header, because
Claude connector config takes a URL.

**Use the per-user token, not a shared one.** The Data Dawgs worker exposes two shapes and
they are not equivalent: `/mcp/{DAWG_PASS}` is shared, anonymous and read-only — the server
cannot tell one caller from another — while `/mcp/u_{token}` is minted per member from a
signed-in session at `signon.html#connect`, stored hashed, and revocable individually. That
per-user form is the one that makes the call know *who* is asking, which is the precondition
for attributing a write to an account. SwoleDawg writes, so it must mint through the same
session-authenticated flow rather than issuing a standalone token: mirror `mint`/`revoke`,
store only the hash, and show the URL exactly once.

The URL is the credential either way — Claude's connector UI takes a URL and has no field for
a custom header, so the secret rides in the path and leaks through screenshots. Per-user makes
a leak *containable* (rotate one row, nobody else is disturbed); it does not make it secure and
must never be described as security.

| Tool | Args | Returns |
|---|---|---|
| `sd_whoami` | — | athlete, current block, derived week, today's prescribed day |
| `sd_get_program` | `day?` | full program or one day, with rest values |
| `sd_today` | — | today's session if started, else the prescribed day and its lifts |
| `sd_start_session` | `date?`, `day_key?` | session id; infers day from weekday if omitted |
| `sd_log_set` | `exercise`, `set_number?`, `weight_lb`, `reps`, `rir?`, `rest_taken_s?` | the stored row + what's left in the exercise |
| `sd_log_sets` | `sets[]` | bulk version — for "I did 12, 11, and 10 at thirty" |
| `sd_finish_session` | `notes?` | session summary: volume, sets, duration |
| `sd_session` | `date` | one session, all sets |
| `sd_recent_sessions` | `n?` | last n sessions, summarized |
| `sd_exercise_history` | `exercise`, `n?` | that lift over time, for progression calls |
| `sd_progression_check` | — | lifts that hit top-of-range on every set twice running |
| `sd_log_measurement` | `field`, `value`, `reads?`, `date?` | stored row + delta from baseline in the correct direction |
| `sd_log_measurements` | `fields{}` | bulk — for a Sunday tape session |
| `sd_measurement_due` | — | which fields are due today given each field's cadence |
| `sd_log_nutrition` | `kcal?`, `protein_g?`, `date?` | stored row |
| `sd_log_ruck` | `duration_min`, `incline_pct?`, `speed_mph?`, `load_lb?`, `surface?` | stored row — **refuses if the ankle flag is tripped** |
| `sd_safety_status` | — | ankle flag state, open gates, and what each currently blocks |
| `sd_update_program` | `patch` | new program version; never mutates in place |

**Gating.** `program.json` carries a `gates` array. `lower_body_clearance` is OPEN, which means
`tue_3` (goblet squat) and `tue_5` (reverse lunge) are bodyweight-only. `sd_log_set` must
accept a load on a gated exercise but return the gate text alongside the confirmation, and the
site must render the gated prescription rather than the ungated one. When the gate closes,
flipping one field in the program unlocks both lifts.

**Measurement direction awareness.** `sd_log_measurement` returns the delta *interpreted*:
waist 37.0 → 36.5 comes back as progress, not as a negative number. The model will read this
aloud and a raw signed delta invites the wrong conclusion.

**`exercise` must accept fuzzy input.** Kap will say "bench," "flat bench," "db bench press."
Match case-insensitively against `id`, then exact name, then substring, then a simple token
overlap. On ambiguity return the candidates rather than guessing — a wrong exercise match
silently corrupts the history, which is worse than one extra clarifying turn.

**`set_number` should be inferrable.** If omitted, use the next unlogged set for that exercise
in the current session. Kap should be able to say "another 10" and have it land correctly.

**Every tool returns what to do next.** `sd_log_set` should come back with something like
`set 2 of 2 logged · exercise complete · next: overhead triceps extension · rest 90s`. The
model is going to read that aloud mid-workout; make it a sentence, not a blob.

---

## 4. Worker — read API for the site

```
GET  /api/program                 → current program JSON
GET  /api/summary                 → weight, body fat, lean mass, waist, sessions last 7d
GET  /api/sessions/recent?n=10    → session list
GET  /api/session/{date}          → one session with sets
POST /api/set                     → same UPSERT as sd_log_set, source='web'
POST /api/session/start
POST /api/session/finish
```

CORS: `Access-Control-Allow-Origin: https://datadawgs216.com` plus localhost for dev. Handle
preflight. Writes require the same token — put it in a `X-SD-Token` header, and have the page
read it from a `?k=` query param the first time so Kap can bookmark an authorized URL rather
than typing a token on a phone.

---

## 5. Front end changes to `swoledawg.html`

**Remove** the Data Dawgs global nav strip. SwoleDawg is not a section of that site anymore
and the strip still renders SwoleDawg as the active item. Check whether the same markup is
hardcoded in sibling pages; if so, extract it once rather than editing each.

**Training tab** gets the session logger. Port from `swoledawg-session.html`, which is a
working mockup — the following behaviors are already correct and should survive the port:

- Rest duration comes from the active exercise's `rest_between_sets`; the transition after
  the last set uses `rest_after_exercise`; unilateral lifts use `rest_between_sides`.
- Gauge segments derive from duration: 30s ticks at or above 120s, 15s ticks below.
- Timer counts past zero and shows `+0:14` in red. `rest_taken_s` records the real number.
- At zero: two short tones then a longer higher one, screen flash, `navigator.vibrate`.
- `−15 / +15` override with a snap-back to the recommended value; overrides persist per
  exercise per phase for the session.
- Auto and Alert toggles.

**Two things the mockup gets wrong that must be fixed in the port:**

1. **The timer counts ticks.** When the phone screen locks, `setInterval` throttles and the
   count silently drifts. Store a wall-clock target with `Date.now()` and derive remaining
   from that, so it self-corrects when the tab wakes. Request a `navigator.wakeLock` during
   active rest and release it on completion.
2. **State is in memory.** Every logged set must POST to `/api/set`. Queue writes offline and
   flush on reconnect — a phone in a basement gym will drop connection.

**Do not** introduce localStorage, a framework, a bundler, or npm. Hand-written static
HTML/CSS/JS, same as the rest of the site.

---

## 6. Settings tab

New tab, last position. Renders the content of `claude-project-setup.md`. Requirements:

- Copy buttons on the connector URL, the custom instructions block, and the project knowledge
  block. Setup must be doable on a phone with zero manual typing.
- The connector URL is **composed, never hardcoded**. `claude-project-setup.md` ships the
  literal placeholder `{{MCP_BASE}}`; Settings substitutes the worker origin at render time
  from the same constant the page uses for the read API (§4), so there is exactly one place
  the hostname lives. Do not write a workers.dev hostname into the markdown, the page, or the
  spec — the real origin is whatever `wrangler deploy` prints, and the account subdomain is
  not knowable in advance.
- If that constant is unset, the copy button is disabled and the row reads "worker not
  deployed" rather than copying a placeholder or a guessed URL.
- The connector URL displays masked by default with a reveal toggle.
- A **Test connection** button that pings `sd_whoami` through the read API and reports back.
- A short "what Claude can and cannot do" section, honestly stated — it can log sets, read
  history, and update the program; it cannot deploy the site or edit code.

---

## 7. Measurements — schema and display rules

Replace the single `bodyweight` table with a tagged measurement store. Every field carries a
tag and a direction; nothing in the UI may infer either.

```sql
CREATE TABLE measurement_fields (
  field       TEXT PRIMARY KEY,     -- 'waist_navel_in'
  label       TEXT NOT NULL,
  site        TEXT,                 -- protocol text, shown on hover/tap
  tier        INTEGER NOT NULL,     -- 1 core · 2 goal · 3 drift · 4 safety
  cadence     TEXT NOT NULL,        -- daily|weekly|monthly|once
  tag         TEXT NOT NULL,        -- OBSERVED|DERIVED|MODELLED|PLAN
  direction   TEXT NOT NULL,        -- up|down|flat
  baseline    REAL,
  target_lo   REAL,
  target_hi   REAL,
  expected_asymmetry REAL,          -- calf_asymmetry_in = 1.0
  is_formula_input INTEGER DEFAULT 0
);

CREATE TABLE measurements (
  date   TEXT NOT NULL,
  field  TEXT NOT NULL REFERENCES measurement_fields(field),
  value  REAL,
  reads  TEXT,                      -- JSON array of raw tape reads before averaging
  source TEXT NOT NULL,             -- 'claude' | 'web'
  PRIMARY KEY (date, field)
);
```

**Seven display rules that are not optional.** Each one prevents a specific failure:

1. **Direction drives colour, not the sign of the delta.** Weight, both waist fields, hips,
   and body fat are all supposed to fall. A UI that paints any decrease as regression will
   report failure for six months during the exact period the plan is working.
2. **`waist_navel_in` and `waist_narrow_in` never merge.** The first is the Navy formula input
   and must never change sites for the life of the dataset. The second is the aesthetic
   number. Conflating them retroactively corrupts the body fat history.
3. **MODELLED renders visibly differently from OBSERVED and DERIVED.** `bf_true_pct` carries
   roughly ±3 points. Shown as a plain number next to a measured one, it will be treated as
   measured inside a month. Different weight, a tag pill, or a ± range — pick one and apply
   it everywhere.
4. **Neck confounds the headline.** Pressing and rowing thicken the neck; every 0.25" gained
   drops `navy_bf_pct` about 0.4 points with no fat lost. Publish a `bf_waist_only` variant
   holding neck at the 15.5" baseline, or annotate the chart wherever neck moved.
5. **`calf_asymmetry_in` has `expected_asymmetry: 1.0`.** Surgical, permanent, not a training
   target. Do not render it as an unresolved imbalance.
6. **Tier 4 ankle fields get their own panel with no progress framing.** They are an
   instrument, not a goal. No bars, no percent-to-target, no green.
7. **Forearm is the calibration anchor.** It barely responds to this program. Movement over
   0.5" in either direction means suspect tape technique before believing anything else from
   that session — surface that as a warning on the session, not a physique change.

**Derived fields** compute server-side so Claude and the site can't disagree:

```
navy_bf_pct   = 86.010 × log10(waist_navel − neck) − 70.041 × log10(height) + 36.76
bf_true_pct   = navy_bf_pct + skin_offset        // 0 to +1, MODELLED
lean_mass_lb  = weight × (1 − bf_true_pct/100)
ffmi          = (lean_mass_lb × 0.4536) / 3.533
adonis        = shoulders / waist_navel
waist_height  = waist_navel / height
waist_hip     = waist_navel / hips
arm_forearm   = arm_flexed / forearm
arm_flex_gap  = arm_flexed − arm_relaxed
calf_asym     = calf_l − calf_r
ankle_asym    = |ankle_l − ankle_r|
```

**Week derivation.** The current week is never stored in `program.json` and never typed into a
page. `program.json` carries `block_start_date` (a Monday); the week is
`floor((monday_of(today) − block_start_date) / 7) + 1`, clamped to a minimum of 1 so a date
before the block begins reads week 1 rather than week 0. Weeks turn over on Monday so they
line up with the day list. Sessions store the week they were performed in — derive it at write
time and leave it alone afterward, so recomputing a week boundary never rewrites history.

`effort_schedule` is keyed by that derived week. Week 1 carries `sets_override: 2`, which wins
over the per-exercise `sets` in the day tables — every client that renders or prescribes sets
must apply it, not just display the schedule. Match the week exactly; only fall through to the
open-ended `4+` row when the week is actually 4 or greater, and never fall through to it for an
unmatched low week — that would hand the most aggressive setting to a block that hasn't started.

**Radar chart.** `radar.html` already works and prefers `/api/summary` over its embedded
baseline. Serve it the eight keys it looks for (`waist`, `bodyfat`, `chest`, `arm`,
`shoulders`, `vtaper`, `weight`, `hips`). Keep its disclosure note: waist feeds three of the
eight spokes, so waist progress inflates apparent convergence roughly threefold. The
independent spokes are chest, arm, shoulders, weight.

New tools: `sd_log_measurement`, `sd_log_measurements` (bulk, for a tape session),
`sd_measurement_history`, `sd_convergence`. Store raw reads in `reads` when more than one was
taken — the protocol calls for averaging two within 0.125" or taking a median of three, and
the audit trail is worth keeping.

---

## 8. Restrictions engine — user data, not program data

This is a consumer app. No user's injuries belong in the codebase or in a program file. The
program references restrictions by id; the restrictions themselves are rows the user owns and
edits in Settings. See `restrictions.json` for the schema, the six restriction kinds, the
scope-matching types, and a seeded set.

```sql
CREATE TABLE restrictions (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL,   -- movement_ban|load_cap|range_cap|monitor|gate|preference
  scope        TEXT NOT NULL,   -- JSON: equipment/pattern/joint/exercise_id/name_match
  severity     TEXT NOT NULL,   -- hard|soft
  load_cap_lb  REAL,
  text         TEXT,            -- range_cap wording, shown verbatim
  watch_for    TEXT,            -- JSON array, monitor kind
  action       TEXT,
  reason       TEXT,
  user_note    TEXT,
  source       TEXT,            -- user_experience|surgical_history|anthropometry|environment
  active       INTEGER NOT NULL DEFAULT 1,
  resolved_at  TEXT,            -- gate kind: when clearance came in
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
```

Never delete a restriction — set `active = 0`. A restriction that was in force for six weeks
explains six weeks of programming decisions, and removing the row makes that history
unreadable.

### The preamble tool

`sd_get_restrictions` is the mechanism the user asked for. It returns both the structured rows
and an assembled plain-text preamble. Every plan-generating or plan-modifying path calls it
first — `sd_update_program`, any "build me next week," any exercise substitution.

```
GET /api/restrictions        → { restrictions: [...], preamble: "..." }
POST /api/restrictions       → create
PATCH /api/restrictions/{id} → edit, deactivate, or resolve a gate
```

The preamble is assembled server-side, not by the model, so the site and Claude cannot drift.
Shape:

```
ACTIVE RESTRICTIONS — apply before proposing any exercise.
HARD BANS: barbell horizontal and vertical pressing · dips · upright rows ·
  behind-the-neck · barbell shrugs · jumping and plyometrics · pivoting under load ·
  standing calf raises · rear-foot-elevated with the right foot rear · unstable or
  cambered surfaces · training to failure on dumbbell bench
LOAD CAPS: squat pattern 0 lb · lunge pattern 0 lb  [gate r_foot_load, awaiting clearance]
RANGE RULES: squatting requires 1–1.5" heel elevation · hinge terminates on lumbar rounding
MONITORS: AC joint symptoms → cut seated DB shoulder press first · ankle asymmetry
  over 0.5" → suspend rucking, contact surgeon [UNARMED: no baseline]
NOTE FROM USER: dumbbell versions of the banned barbell lifts are fine — it is
  specifically the bar.
```

`user_note` renders inside the preamble deliberately. Lived experience with a specific joint
outranks pattern-matching from a diagnosis, and the model needs to see the nuance rather than
over-restrict from the label alone.

### Enforcement, by kind

- **`movement_ban` and `load_cap`** enforce in code. The stepper clamps; `sd_log_set` rejects
  and returns the restriction id and reason. A model must not be able to talk past these,
  including at the user's own insistence — overriding is a Settings action with a date and a
  note, so the change is dated rather than argued into existence.
- **`range_cap`** cannot be enforced numerically — the constraint is on movement path. Renders
  as persistent inline text on the active exercise, not a dismissible tip. Anything dismissible
  gets dismissed by week three and these apply on every rep indefinitely. Style distinctly
  from the coaching `cue` field.
- **`monitor`** doesn't constrain the plan; it constrains ignoring symptoms. Surfaces on
  Overview and in `sd_whoami` so Claude raises it unprompted. A monitor whose instrument has no
  baseline ships in a visibly **unarmed** state — never a passing one. Green because there's no
  data is worse than unknown.
- **`gate`** blocks until `resolved_at` is set. Resolution requires a note.
- **`preference`** enforces identically to a ban but is framed as a choice in the UI. Nobody
  wants their dislike of burpees rendered as an injury.

### Settings — Restrictions panel

Preset catalog seeds a restriction the user then edits, plus free-text for anything else.
Presets in `restrictions.json` cover shoulder impingement, AC repair, rotator cuff, lower
back, knee, ankle fusion, hip replacement, wrist/elbow, blood pressure, training alone, and
missing equipment.

Requirements: active and inactive shown separately, with inactive collapsed · gates display
what would resolve them · a monitor with no baseline shows what to measure · one plain line
stating these are user-declared and not a clinical assessment, and that surgical history
should be confirmed with the treating clinician. One line, not a disclaimer wall.

---

## 9. Definition of done

1. `wrangler deploy` puts the worker live with D1 bound and `program.json` seeded.
2. Adding the MCP URL as a custom connector in Claude exposes all tools.
3. Saying "log flat bench, 30 pounds, 11 reps" in a Claude Project writes a row and the
   Training tab shows it after refresh.
4. Tapping a set in the browser writes the same row shape with `source='web'`.
5. The rest timer survives a 60-second screen lock without drifting.
6. Settings copy buttons produce blocks that paste into a Claude Project unmodified.
6a. The connector URL rendered in Settings is the origin `wrangler deploy` actually
    printed, substituted into `{{MCP_BASE}}` — no workers.dev hostname appears as a
    literal anywhere in the repo. With the worker undeployed, the row reads "worker not
    deployed" and the copy button is disabled.
7. A `load_cap` restriction refuses load above its cap from both the browser and `sd_log_set`,
   returning the restriction id and reason.
8. A monitor with no baseline reads "unarmed" rather than green.
9. `radar.html` renders live values off `/api/summary` instead of its embedded baseline.
9a. The week shown is derived from `block_start_date`, rolls over on Monday, and reads 1 —
    not 0 — on a date before the block starts. In week 1 every exercise prescribes 2 working
    sets, not the 3 in the day tables.
10. A field with `direction: down` shows a decrease as progress, in both the table and the
    radar.
11. `sd_get_restrictions` returns a preamble, and asking Claude to build a plan produces one
    that violates no active hard restriction.
12. Deactivating a restriction in Settings changes the next generated plan without any code
    edit — and the deactivated row is still readable in history.

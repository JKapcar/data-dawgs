-- SwoleDawg D1 schema.
--
-- ⚠️ EVERY TABLE CARRIES uid AND EVERY QUERY FILTERS ON IT. There is one athlete today.
-- The schema must not assume one: a missing uid filter is one signed-in member reading
-- or overwriting another's training log. The uid is the same one identity already uses
-- in Firebase under /users/{uid} — D1 holds training data, Firebase holds identity, and
-- the uid is the only join between them.
--
-- Apply with:
--   wrangler d1 execute swoledawg --file=work/swoledawg-schema.sql --remote
--
-- Re-running is safe: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,          -- '{uid}:2026-08-17:monday' — uid first, so a
                                           -- scan by prefix is a scan of one person's log
  uid           TEXT NOT NULL,
  date          TEXT NOT NULL,             -- ISO date, the day it was PERFORMED
  day_key       TEXT NOT NULL,             -- monday|tuesday|…|sunday
  session_type  TEXT NOT NULL,             -- lift|ruck|rest
  block         INTEGER NOT NULL DEFAULT 1,
  -- ⚠️ Derived at write time from block_start_date, then FROZEN. Never recompute it on
  -- read: recomputing would rewrite what week a past session happened in whenever the
  -- block start moves, and the whole point of a log is that the past does not move.
  week          INTEGER NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_uid_date ON sessions(uid, date DESC);

CREATE TABLE IF NOT EXISTS sets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL,
  session_id         TEXT NOT NULL REFERENCES sessions(id),
  exercise_id        TEXT NOT NULL,        -- 'mon_1'
  exercise_name      TEXT NOT NULL,        -- denormalized: program names change, history shouldn't
  set_number         INTEGER NOT NULL,
  weight_lb          REAL,
  reps               INTEGER,
  rir                INTEGER,
  rest_prescribed_s  INTEGER,
  -- ⚠️ Stored separately from prescribed, per the program's own rule: a stalled lift is
  -- usually collapsed rest, not insufficient volume. Collapsing these two into one column
  -- destroys the only evidence that distinguishes those cases.
  rest_taken_s       INTEGER,
  source             TEXT NOT NULL,        -- web|mcp — where the row arrived from, not who typed it
  logged_at          TEXT NOT NULL,
  UNIQUE(session_id, exercise_id, set_number)   -- makes a correction an UPSERT, not a duplicate
);
CREATE INDEX IF NOT EXISTS ix_sets_uid_ex ON sets(uid, exercise_id, logged_at DESC);

-- The plan itself, one row per athlete, stored as the program.json document.
-- Versioned rather than updated in place: a plan change explains every training decision
-- after it, and overwriting the row destroys that explanation.
CREATE TABLE IF NOT EXISTS program (
  uid        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  doc        TEXT NOT NULL,                -- program.json verbatim
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  note       TEXT,
  PRIMARY KEY (uid, version)
);

CREATE TABLE IF NOT EXISTS measurement_fields (
  uid         TEXT NOT NULL,
  field       TEXT NOT NULL,               -- 'waist_navel_in'
  label       TEXT NOT NULL,
  tier        INTEGER,
  cadence     TEXT,
  -- DEVICE was added 2026-08-20 for the Samsung Health sleep channels. A wearable's
  -- number is an algorithm's claim about the body, not a tape reading, and it is kept in
  -- its own bucket so the tape grid and the radar can exclude it. ⚠️ swoleSummary() does
  -- NOT filter on this column — it returns every field for the uid, and swoledawg.html is
  -- what keeps DEVICE out of the body grid. Filter here and you can drop that guard.
  tag         TEXT NOT NULL,               -- OBSERVED|DERIVED|MODELLED|DEVICE
  -- ⚠️ Never inferred in the UI. weight, waist, hips and body fat all DECREASE on
  -- success; a page that colours any decrease as regression reports failure for six
  -- months while the plan is working.
  direction   TEXT NOT NULL,               -- up|down|flat
  baseline    REAL,                        -- NULL means NOT MEASURED. Never backfill.
  target_lo   REAL,
  target_hi   REAL,
  site        TEXT,                        -- the measurement protocol, verbatim
  note        TEXT,
  is_formula_input     INTEGER NOT NULL DEFAULT 0,
  is_safety_instrument INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, field)
);

CREATE TABLE IF NOT EXISTS measurements (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  uid       TEXT NOT NULL,
  field     TEXT NOT NULL,
  date      TEXT NOT NULL,
  value     REAL,                          -- NULL is a recorded gap, not a zero
  -- The protocol calls for averaging two reads within 0.125" or taking the median of
  -- three. Keep what was actually read: a stored average with no raws cannot be audited.
  reads     TEXT,                          -- JSON array of the raw reads
  source    TEXT NOT NULL,                 -- web|mcp
  note      TEXT,
  logged_at TEXT NOT NULL,
  UNIQUE(uid, field, date)                 -- one value per field per day; a re-read UPSERTs
);
CREATE INDEX IF NOT EXISTS ix_meas_uid_field ON measurements(uid, field, date DESC);

CREATE TABLE IF NOT EXISTS nutrition (
  uid        TEXT NOT NULL,
  date       TEXT NOT NULL,
  kcal       INTEGER,
  protein_g  INTEGER,
  note       TEXT,
  source     TEXT NOT NULL,
  logged_at  TEXT NOT NULL,
  PRIMARY KEY (uid, date)
);


-- One row per day, written by the Recovery sheet's ten-field form.
--
-- ⚠️ Added 2026-08-20 to close a SILENT hole. The form shipped in v0.3; `saveRec` only
-- mutated the in-memory day and toasted "Recovery saved", and there was no table behind
-- it. sdHydrateDays hardcoded `recovery:{}`, so the Overview sleep KPI and both Recovery
-- charts read a field that could never populate. Every symptom looked like "nothing
-- logged yet" rather than "nothing was ever saved".
--
-- The form posts the WHOLE day and promises on screen that a blank stays null, so the
-- upsert overwrites every column. A cleared box must clear the stored value; a partial
-- merge here would make the page a liar.
--
-- ⚠️ Nothing in here is derived from the DEVICE sleep fields. `sleep_hours` is what Kap
-- typed; `sleep_total_min` is what the watch estimated. They are different claims and
-- merging them launders one into the other.
CREATE TABLE IF NOT EXISTS recovery (
  uid          TEXT NOT NULL,
  date         TEXT NOT NULL,
  sleep_hours  REAL,                       -- NULL is "not measured", never 0
  sleep_score  REAL,
  hrv          REAL,
  resting_hr   REAL,
  readiness    REAL,
  soreness     REAL,                       -- 1-10, self-reported
  energy       REAL,                       -- 1-10  ⎫ the page calls these three
  mood         REAL,                       -- 1-10  ⎬ `subjective`; they are stored
  joint_feel   REAL,                       -- 1-10  ⎭ here and split only on read
  note         TEXT,
  source       TEXT NOT NULL,              -- web|mcp
  logged_at    TEXT NOT NULL,
  PRIMARY KEY (uid, date)
);
CREATE INDEX IF NOT EXISTS ix_recovery_uid_date ON recovery(uid, date DESC);

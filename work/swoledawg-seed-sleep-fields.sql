-- SwoleDawg — sleep + nightly vitals fields (DEVICE), and the week they were seeded with.
-- Applied to the live database 2026-08-20.
--
-- Apply with:
--   wrangler d1 execute swoledawg --file=work/swoledawg-seed-sleep-fields.sql --remote
-- or paste into the D1 console (Cloudflare dash → D1 → swoledawg → Console).
--
-- Re-running is safe: OR IGNORE on the fields, DO NOTHING on the rows.
--
-- ⚠️ SET THE UID BELOW. An earlier draft of this file drove both statements from
--    `FROM (SELECT DISTINCT uid FROM measurement_fields) u`
--    on the reasoning that there is only one athlete. That is true today and is not a
--    safe thing to encode: statement 2 writes ONE person's screenshotted numbers, and
--    under that form a second athlete silently receives them as their own history. The
--    field definitions in statement 1 would be harmless to fan out; the readings are not.
--    Get the uid with:  SELECT DISTINCT uid FROM measurement_fields;
--
-- ⚠️ D1 REJECTS THE CROSS-JOIN FORM. The original built the 28 rows from a dates
--    subquery UNION ALL'd against a values subquery. D1 caps compound SELECT terms lower
--    than stock SQLite and returns "too many terms in compound SELECT: SQLITE_ERROR".
--    Hence the flat VALUES list below. Nothing is written when it fails, but it fails.
--
-- WHY NO NEW CODE SHIPS WITH THIS FILE: swoleLogMeasurement already validates any field
-- against measurement_fields and writes dated rows, and sd_log_measurement already wraps
-- it over MCP. The generic observation endpoint existed; it was only starved of fields.

-- ---------- fields ----------
-- TAG: 'DEVICE' — a wearable's number is an algorithm's claim about the body, not a tape
-- reading. One bucket, per Kap 2026-08-20, sitting beside OBSERVED|DERIVED|MODELLED.
-- ⚠️ swoleSummary() applies NO tag filter, and bodyProgram() deliberately renders fields
-- it has not been taught about — so without the DEVICE guard in swoledawg.html these land
-- in the body tape grid next to waist and neck. Do not remove that guard.
INSERT OR IGNORE INTO measurement_fields
  (uid, field, label, tier, cadence, tag, direction, baseline, target_lo, target_hi, site, note, is_formula_input, is_safety_instrument)
VALUES
  ('REPLACE_WITH_UID','sleep_total_min','Sleep, total asleep (min)',1,'daily','DEVICE','up',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Sum of all sleep blocks, asleep minutes not in-bed',0,0),
  ('REPLACE_WITH_UID','sleep_deep_min','Sleep, deep (min)',1,'daily','DEVICE','up',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Stage minutes across all blocks',0,0),
  ('REPLACE_WITH_UID','sleep_rem_min','Sleep, REM (min)',1,'daily','DEVICE','up',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Stage minutes across all blocks',0,0),
  ('REPLACE_WITH_UID','sleep_light_min','Sleep, light (min)',1,'daily','DEVICE','flat',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Stage minutes across all blocks',0,0),
  ('REPLACE_WITH_UID','sleep_awake_min','Sleep, awake (min)',1,'daily','DEVICE','down',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Awake minutes inside the sleep window',0,0),
  ('REPLACE_WITH_UID','sleep_hr_bpm','Sleep, avg HR (bpm)',1,'daily','DEVICE','down',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Nightly average',0,0),
  ('REPLACE_WITH_UID','sleep_spo2_pct','Sleep, avg SpO2 (pct)',1,'daily','DEVICE','up',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Nightly average',0,0),
  ('REPLACE_WITH_UID','sleep_rr_min','Sleep, resp rate (per min)',1,'daily','DEVICE','flat',NULL,NULL,NULL,'Samsung Health / Galaxy Watch, nightly','Nightly average',0,0);

-- Labels follow the house style already in the table — 'Bodyweight (lb)',
-- 'Body fat, estimated (pct)' — commas and (pct), not em dashes.

-- ---------- backfill 2026-08-13 .. 2026-08-19 ----------
-- Only the four channels Kap could vouch for. STAGE FIELDS ARE NOT BACKFILLED: the only
-- real stage split on hand was a 90-minute morning block, and projecting it across seven
-- nights would be invention. A null is a recorded gap, not a hole to paper over.
--
-- 2026-08-19 carries the actually-screenshotted vitals. The prior six carry the same
-- values with a note saying they are reported-typical, not read — so the copies are
-- self-identifying in the ledger rather than passing as separate observations.
INSERT INTO measurements (uid, field, date, value, reads, source, note, logged_at) VALUES
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-13',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-13',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-13',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-13',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-14',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-14',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-14',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-14',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-15',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-15',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-15',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-15',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-16',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-16',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-16',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-16',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-17',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-17',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-17',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-17',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-18',582.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-18',64.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-18',97.0,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-18',14.7,NULL,'mcp','backfill - reported identical week, values copied from 2026-08-19',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_total_min','2026-08-19',582.0,NULL,'mcp','Samsung Health screenshot 2026-08-20',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_hr_bpm','2026-08-19',64.0,NULL,'mcp','Samsung Health screenshot 2026-08-20',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_spo2_pct','2026-08-19',97.0,NULL,'mcp','Samsung Health screenshot 2026-08-20',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('REPLACE_WITH_UID','sleep_rr_min','2026-08-19',14.7,NULL,'mcp','Samsung Health screenshot 2026-08-20',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
ON CONFLICT(uid, field, date) DO NOTHING;   -- never overwrite a real reading with backfill

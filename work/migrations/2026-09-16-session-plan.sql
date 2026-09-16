-- Run with the guarded migration runner, NOT directly with wrangler --file.
-- day_key already exists. IDs and foreign keys are preserved.
ALTER TABLE sessions ADD COLUMN plan_json TEXT;
ALTER TABLE sessions ADD COLUMN plan_selected_at TEXT;

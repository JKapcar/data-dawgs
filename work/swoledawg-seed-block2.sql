-- SwoleDawg Block 2 seed. Remote state checked 2026-08-31: active row was version 3.
-- Idempotent for version 4: keeps all prior versions and only flips the active pointer.
-- D1 remote imports reject explicit BEGIN/COMMIT. The activation is guarded on the
-- inserted row existing, so a failed insert cannot deactivate the current program.
INSERT INTO program (uid, version, doc, active, created_at, note)
SELECT 'u_y9Pgnfml5AlhtotzlailibDR', 4, '{
  "schema_version": "3.0",
  "program_name": "Kap — Block 2",
  "athlete": "Kap",
  "baseline_date": "2026-09-01",
  "block": 2,
  "block_start_date": "2026-08-31",
  "week_derivation": "current_week = floor((monday_of(today) - block_start_date) / 7 days) + 1. The week number is never stored; block_start_date is the only week fact in this file. Weeks turn over on Monday so they line up with the day list.",
  "priority": [
    "chest",
    "biceps",
    "triceps"
  ],
  "nutrition": {
    "protein_g": 180,
    "rule": "Do not eat back training calories.",
    "deficit_review_trigger": "waist_navel_in reaches 35.0 — not a calendar date",
    "mode": "recomp",
    "kcal_target": 2960,
    "kcal_band": 300
  },
  "rules": {
    "rest_units": "seconds",
    "rest_between_sets": "timer starts when the last rep of a set is racked",
    "rest_after_exercise": "transition timer — includes changing selector and bench angle",
    "same_weight_every_set": true,
    "no_pyramiding": "Straight sets give more quality volume and a clean read on progression",
    "calibration_override": "Set 1 below the bottom of range → drop one increment for the remaining sets and start there next session. Set 1 more than 2 reps above the top → add one increment immediately. Sets 2-3 below range with set 1 in range → hold the load; that is fatigue, not mis-loading.",
    "never_to_failure": "No failure on dumbbell bench without a spotter. Failure is permitted on the last set of curls and rear-delt work only.",
    "log_both_rest_values": "Store rest_prescribed_s and rest_taken_s separately. A stalled lift is usually collapsed rest, not insufficient volume.",
    "loading_heavy_dumbbells": "Sit with the bells on your thighs, kick one knee up at a time as you lie back. Reverse to get out.",
    "specialization": "Block 2 is a chest + arms specialization. Back (6 sets), rear delts (4) and legs (4) are explicit maintenance and are not expected to grow. Cut from the BOTTOM of a day''s order if time runs out, never the top.",
    "regional_split": "Monday biases the sternal head (flat), Thursday the clavicular head (30° incline). Peak clavicular activation sits near 30° and falls off above 45° as the front delt takes over.",
    "per_hand_convention": "Every weight_lb value is PER HAND. Overhead extension uses two dumbbells for this reason — a single bell held in both hands breaks the convention and silently halves that lift''s contribution to SUM(weight_lb * reps)."
  },
  "effort_schedule": [
    {
      "week": 1,
      "reps_in_reserve": 3,
      "sets_override": 3,
      "note": "Tendon ramp: drop the last set only from exercises prescribed for 4 sets."
    },
    {
      "week": 2,
      "reps_in_reserve": 3,
      "sets_override": 3,
      "note": "Tendon ramp: drop the last set only from exercises prescribed for 4 sets."
    },
    {
      "week": 3,
      "reps_in_reserve": 3,
      "sets_override": 3,
      "note": "Tendon ramp: drop the last set only from exercises prescribed for 4 sets."
    },
    {
      "week": "4+",
      "reps_in_reserve": null,
      "sets_override": null,
      "note": "Use each exercise’s written RIR."
    }
  ],
  "progression": {
    "model": "double_progression",
    "trigger": "top of rep range on every working set, two consecutive sessions",
    "increment_lb_per_hand": 2.5,
    "increment_lb_per_hand_above_25": 5,
    "tendon_ramp": "Weeks 1-3: RIR 3 on everything, and drop the last set of every 4-set exercise. Ten years detrained; connective tissue adaptation lags muscle by weeks to months. Move to the written RIR values from week 4.",
    "dumbbell_ceiling": "At 52.5 lb/hand, escalate in this order: add reps toward 20-30, then 3-4s eccentrics with a stretched pause, then lengthened partials after full-ROM failure, then cut rest to 60-75s, then unilateral/1.5-reps/drop sets. Do NOT add sets past the weekly ceiling.",
    "falsifiable_test": "Muscle-memory literature predicts rapid reacquisition in a detrained former lifter. If loads climb 5-10 lb session over session on mon_1, thu_1 and tue_1, this scheme is holding you back and gets rewritten.",
    "first_check": "2026-09-21"
  },
  "days": [
    {
      "day": "monday",
      "name": "Chest (sternal) / Triceps / Lower maintenance",
      "exercises": [
        {
          "id": "mon_1",
          "name": "Flat DB bench press",
          "type": "dynamic",
          "sets": 4,
          "rep_min": 8,
          "rep_max": 12,
          "rir": 2,
          "start_weight_lb_per_hand": 30,
          "step": 5,
          "rest_between_sets": 180,
          "rest_after_exercise": 180,
          "cue": "Priority lift. Sit with the bells on your thighs, kick one knee up at a time as you lie back."
        },
        {
          "id": "mon_2",
          "name": "Flat DB flye",
          "type": "dynamic",
          "sets": 4,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 120,
          "cue": "Sternal bias. Slight elbow bend held fixed, wide arc, deep stretch at the bottom. Don''t chase load."
        },
        {
          "id": "mon_3",
          "name": "Seated overhead DB extension (two bells)",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 2,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Overhead position produced ~20% triceps growth vs ~13% for the neutral position (Maeo 2023), disproportionately in the long head. Two bells, one per hand — weight is per hand like everything else."
        },
        {
          "id": "mon_4",
          "name": "DB skullcrusher",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 1,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 120,
          "cue": "Stop the set on any elbow discomfort, not at a rep count."
        },
        {
          "id": "mon_5",
          "name": "Leg extension (leg developer)",
          "type": "dynamic",
          "sets": 2,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Maintenance only. Load unrecorded — confirm the leg developer has plates or these sets do nothing."
        },
        {
          "id": "mon_6",
          "name": "Leg curl (leg developer)",
          "type": "dynamic",
          "sets": 2,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "rest_between_sets": 90,
          "rest_after_exercise": 0,
          "cue": "Maintenance only."
        }
      ]
    },
    {
      "day": "tuesday",
      "name": "Biceps / Back maintenance / Delts",
      "exercises": [
        {
          "id": "tue_1",
          "name": "Incline DB curl (45°)",
          "type": "dynamic",
          "sets": 4,
          "rep_min": 8,
          "rep_max": 12,
          "rir": 2,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Priority lift. Let the arm hang behind the torso — the stretched position is the point, and beat preacher curls for biceps brachii growth in direct comparison."
        },
        {
          "id": "tue_2",
          "name": "Hammer curl",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 1,
          "start_weight_lb_per_hand": 20,
          "step": 2.5,
          "rest_between_sets": 75,
          "rest_after_exercise": 120,
          "cue": "Brachialis and brachioradialis. Brachialis growth pushes the biceps peak up."
        },
        {
          "id": "tue_3",
          "name": "One-arm DB row",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 12,
          "rir": 3,
          "start_weight_lb_per_hand": 35,
          "step": 5,
          "rest_between_sets": 150,
          "rest_after_exercise": 120,
          "cue": "Maintenance. Straps once heavy. Approaching the 52.5 ceiling this block — add reps and eccentric tempo, not sets."
        },
        {
          "id": "tue_4",
          "name": "Rear-delt fly (chest-supported)",
          "type": "dynamic",
          "sets": 2,
          "rep_min": 15,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 10,
          "step": 2.5,
          "rest_between_sets": 60,
          "rest_after_exercise": 75,
          "cue": "Maintenance."
        },
        {
          "id": "tue_5",
          "name": "Lateral raise",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 7.5,
          "step": 2.5,
          "rest_between_sets": 75,
          "rest_after_exercise": 0,
          "cue": "Dropped from 10 lb per the calibration rule — 10 lb produced 10 reps against a 12-15 range on 2026-08-17. Build to 20 across all three sets before going back up. Lead with the elbows, no body English."
        }
      ]
    },
    {
      "day": "wednesday",
      "name": "Ruck",
      "exercises": []
    },
    {
      "day": "thursday",
      "name": "Chest (clavicular) / Triceps / Delts",
      "exercises": [
        {
          "id": "thu_1",
          "name": "Incline DB press (30°)",
          "type": "dynamic",
          "sets": 4,
          "rep_min": 8,
          "rep_max": 12,
          "rir": 2,
          "start_weight_lb_per_hand": 20,
          "step": 2.5,
          "rest_between_sets": 180,
          "rest_after_exercise": 180,
          "cue": "Priority lift. Hold 30° — above 45° the front delt takes over and the upper chest gets less, not more."
        },
        {
          "id": "thu_2",
          "name": "Incline DB flye (30°)",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 12.5,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 120,
          "cue": "Clavicular bias. Deep stretch, stop before the shoulders roll forward."
        },
        {
          "id": "thu_3",
          "name": "Seated overhead DB extension (two bells)",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 2,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Two bells, one per hand."
        },
        {
          "id": "thu_4",
          "name": "Close-grip DB press",
          "type": "dynamic",
          "sets": 2,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 1,
          "start_weight_lb_per_hand": 25,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Bells pressed together, elbows tracking close. Lateral and medial head bias — different tendon stress from Monday''s skullcrusher."
        },
        {
          "id": "thu_5",
          "name": "Lateral raise",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 12,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 7.5,
          "step": 2.5,
          "rest_between_sets": 75,
          "rest_after_exercise": 0,
          "cue": null
        }
      ]
    },
    {
      "day": "friday",
      "name": "Biceps / Shoulders / Back maintenance",
      "exercises": [
        {
          "id": "fri_1",
          "name": "Incline DB curl (45°)",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 8,
          "rep_max": 12,
          "rir": 2,
          "start_weight_lb_per_hand": 15,
          "step": 2.5,
          "rest_between_sets": 90,
          "rest_after_exercise": 90,
          "cue": "Priority lift."
        },
        {
          "id": "fri_2",
          "name": "Standing DB curl",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 15,
          "rir": 1,
          "start_weight_lb_per_hand": 20,
          "step": 2.5,
          "rest_between_sets": 75,
          "rest_after_exercise": 120,
          "cue": "Last set to failure — low injury cost on curls."
        },
        {
          "id": "fri_3",
          "name": "Seated DB shoulder press",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 8,
          "rep_max": 12,
          "rir": 2,
          "start_weight_lb_per_hand": 20,
          "step": 2.5,
          "rest_between_sets": 150,
          "rest_after_exercise": 120,
          "cue": "Front delt work supports pressing carryover."
        },
        {
          "id": "fri_4",
          "name": "One-arm DB row",
          "type": "dynamic",
          "sets": 3,
          "rep_min": 10,
          "rep_max": 12,
          "rir": 3,
          "start_weight_lb_per_hand": 35,
          "step": 5,
          "rest_between_sets": 150,
          "rest_after_exercise": 90,
          "cue": "Maintenance."
        },
        {
          "id": "fri_5",
          "name": "Rear-delt fly (chest-supported)",
          "type": "dynamic",
          "sets": 2,
          "rep_min": 15,
          "rep_max": 20,
          "rir": 1,
          "start_weight_lb_per_hand": 10,
          "step": 2.5,
          "rest_between_sets": 60,
          "rest_after_exercise": 0,
          "cue": "Maintenance."
        }
      ]
    },
    {
      "day": "saturday",
      "name": "Ruck",
      "exercises": []
    },
    {
      "day": "sunday",
      "name": "Off",
      "exercises": []
    }
  ],
  "weekly_volume_targets_sets": {
    "chest": 15,
    "biceps": 13,
    "triceps": 11,
    "side_delts": 6,
    "front_delts": 3,
    "back": 6,
    "rear_delts": 4,
    "quads": 2,
    "hamstrings_glutes": 2
  },
  "weekly_volume_audit": {
    "source": "research-revised prescription; direct working sets only",
    "chest": 15,
    "biceps": 13,
    "triceps": 11,
    "side_delts": 6,
    "front_delts": 3,
    "back": 6,
    "rear_delts": 4,
    "quads": 2,
    "hamstrings": 2
  },
  "open_items": [
    "Leg extension and leg curl load remain unrecorded; confirm plates before counting these as effective maintenance.",
    "Restrictions table and hold_seconds migration remain undeployed."
  ],
  "tagging": {
    "weights": "per hand for every dumbbell exercise, including overhead extensions with two dumbbells",
    "simulation": false
  }
}', 0, datetime('now'), 'Block 2 research-revised prescription; chest 15, biceps 13, triceps 11; weeks 1-3 RIR 3 with 4-set lifts trimmed to 3; two-bell overhead extensions.'
WHERE NOT EXISTS (SELECT 1 FROM program WHERE uid='u_y9Pgnfml5AlhtotzlailibDR' AND version=4);
UPDATE program SET active=CASE WHEN version=4 THEN 1 ELSE 0 END
WHERE uid='u_y9Pgnfml5AlhtotzlailibDR'
  AND EXISTS (SELECT 1 FROM program WHERE uid='u_y9Pgnfml5AlhtotzlailibDR' AND version=4);

-- Idempotent; no recorded plan is overwritten. Unknown prefixes are not guessed.
WITH counts AS (
 SELECT s.id, substr(x.exercise_id,1,instr(x.exercise_id,'_')-1) prefix, COUNT(*) n
 FROM sessions s JOIN sets x ON x.session_id=s.id AND x.uid=s.uid
 WHERE s.plan_json IS NULL AND substr(x.exercise_id,1,instr(x.exercise_id,'_')-1) IN ('mon','tue','thu','fri')
 GROUP BY s.id,prefix
), winners AS (
 SELECT id,prefix FROM counts c WHERE n=(SELECT MAX(n) FROM counts b WHERE b.id=c.id)
), inferred AS (
 SELECT id,CASE WHEN COUNT(*)>1 THEN 'custom' ELSE
 CASE MAX(prefix) WHEN 'mon' THEN 'monday' WHEN 'tue' THEN 'tuesday' WHEN 'thu' THEN 'thursday' WHEN 'fri' THEN 'friday' END END day_key
 FROM winners GROUP BY id
)
UPDATE sessions SET day_key=(SELECT day_key FROM inferred WHERE inferred.id=sessions.id)
WHERE plan_json IS NULL AND id IN (SELECT id FROM inferred)
AND day_key IS NOT (SELECT day_key FROM inferred WHERE inferred.id=sessions.id);

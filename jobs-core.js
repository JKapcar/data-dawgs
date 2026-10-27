/* Job Harness shared core — pure functions, no I/O, no storage, no network.
 * Served to jobs.html AND injected verbatim into the Worker's DD-JOBS block by
 * work/assemble.mjs, so the page and the server compute "what is the current
 * status?" with the same code. Edit it HERE; the Worker copy is generated.
 *
 * A record's `events` array is an append-only log. Nothing in it is edited or
 * removed. Entry kinds (an entry with no `kind` is a status update — the v1 shape):
 *   status            stage/outcome evidence for one moment in time
 *   correction        replaces or voids ONE earlier status entry (by index), with a note;
 *                     the original stays in the log, the latest correction wins
 *   record_correction listing-field changes, stored as {field: {from, to}}
 *   archive / restore hide or show the record; history and duplicate detection unchanged
 * The effective timeline is every status entry after corrections (voided ones dropped),
 * ordered by occurred_at, then log position. The current status is its last entry. */
const JOBS_CORE = (() => {
  'use strict';
  const STAGES = ['opportunity', 'screened', 'approved', 'prepared', 'submitted', 'interview', 'offer', 'closed'];
  const OUTCOMES = ['none', 'no_later_decision', 'rejected', 'position_closed', 'no_current_match', 'blocked_not_submitted', 'withdrawn', 'accepted'];
  // Stages that assert an application actually reached the employer.
  const SUBMISSION_STAGES = ['submitted', 'interview', 'offer'];
  const CLOSED_OUTCOMES = ['rejected', 'position_closed', 'no_current_match', 'withdrawn', 'accepted'];
  // Exactly the server's status rules, as a table the page can build its menus from.
  const OUTCOMES_BY_STAGE = Object.freeze({
    opportunity: ['none', 'blocked_not_submitted'],
    screened: ['none', 'blocked_not_submitted'],
    approved: ['none', 'blocked_not_submitted'],
    prepared: ['none', 'blocked_not_submitted'],
    submitted: ['none', 'no_later_decision'],
    interview: ['none', 'no_later_decision'],
    offer: ['none'],
    closed: CLOSED_OUTCOMES
  });
  const STATUS_FIELDS = ['stage', 'outcome', 'occurred_at', 'verified_at', 'evidence_url', 'reason_kind', 'reason', 'next_action', 'blocker', 'resume_version'];
  const LISTING_FIELDS = ['employer_key', 'employer', 'role', 'requisition', 'url', 'url_verified_at'];
  const kindOf = entry => (entry && entry.kind) || 'status';
  const stageRank = stage => STAGES.indexOf(stage);
  const pick = (source, keys) => Object.fromEntries(keys.map(k => [k, source[k]]));

  // Canonical form only — compatibility characters, invisible format characters (zero-width
  // spaces, joiners, bidi marks), case and runs of whitespace. No fuzzy matching, no prefix
  // stripping: "REQ-1" and "1" stay different requisitions.
  function normalizeRequisition(text) {
    return String(text).normalize('NFKC').replace(/\p{Cf}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function identityOf(listing) {
    return listing.requisition === null ? listing.employer_key + '|source:' + (listing.source_id || listing.id) : listing.employer_key + '|' + normalizeRequisition(listing.requisition);
  }
  // Advisory only (shared career pages host many roles): same host, path and query.
  function listingKey(url) {
    try {
      const u = new URL(url);
      return u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search;
    } catch { return null; }
  }
  const sameFact = (a, b) => a.stage === b.stage && a.outcome === b.outcome &&
    a.occurred_at === b.occurred_at && (a.evidence_url || null) === (b.evidence_url || null) && JSON.stringify(a.evidence||null)===JSON.stringify(b.evidence||null);
  const statusOf = source => ({...pick(source,STATUS_FIELDS),...(source.evidence?{evidence:source.evidence}:{})});
  const hasEvidence = e => !!(e.evidence_url || (e.evidence?.kind==='historical_portal_acknowledgment' && e.evidence.source_ref && e.evidence.source_id));

  function history(record) {
    const events = Array.isArray(record && record.events) ? record.events : [];
    const latestCorrection = new Map();
    let archived = null;
    events.forEach((entry, at) => {
      const kind = kindOf(entry);
      if (kind === 'correction') latestCorrection.set(entry.target, at);
      else if (kind === 'archive') archived = {at, recorded_at: entry.recorded_at || null};
      else if (kind === 'restore') archived = null;
    });
    const timeline = [], superseded = new Map();
    events.forEach((entry, at) => {
      if (kindOf(entry) !== 'status') return;
      const by = latestCorrection.get(at);
      if (by === undefined) { timeline.push({...statusOf(entry), at, corrected_by: null}); return; }
      const correction = events[by];
      superseded.set(at, {by, action: correction.action});
      if (correction.action === 'void') return;
      timeline.push({...statusOf(correction.replacement || {}), at, corrected_by: by});
    });
    // Unknown dates cannot establish chronology. Preserve append order in that case.
    if(timeline.every(e=>e.occurred_at!==null))timeline.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.at - b.at));
    return {timeline, current: timeline.length ? timeline[timeline.length - 1] : null, archived, superseded};
  }

  // The first place an effective timeline contradicts itself, or null. Kept consistent
  // by the server: plain appends cannot create a conflict, corrections are refused if
  // they would.
  function conflict(timeline) {
    let dated=null;
    for(const e of timeline)if(e.occurred_at){if(dated&&e.occurred_at<dated.occurred_at)return {kind:'chronology',before:dated.at,after:e.at};dated=e;}
    for (let i = 1; i < timeline.length; i++) {
      if (stageRank(timeline[i].stage) < stageRank(timeline[i - 1].stage))
        return {kind: 'stage_regression', before: timeline[i - 1].at, after: timeline[i].at};
    }
    let submitted = null;
    for (const step of timeline) {
      if (SUBMISSION_STAGES.includes(step.stage)) submitted = submitted || step;
      else if (step.outcome === 'blocked_not_submitted' && submitted)
        return {kind: 'blocked_after_submission', before: submitted.at, after: step.at};
    }
    return null;
  }

  // A correction may assert a submission only where one is already effective, or by restoring
  // the original entry exactly. Anything else that says "it reached the employer" must be a new,
  // evidenced update. (Checking only the original entry let a submission be downgraded and then
  // re-upgraded with a new date and evidence.)
  function correctionMaySubmit(original, effective, replacement) {
    if (!SUBMISSION_STAGES.includes(replacement.stage)) return true;
    if (effective && SUBMISSION_STAGES.includes(effective.stage)) return true;
    return SUBMISSION_STAGES.includes(original.stage) && STATUS_FIELDS.every(k => original[k] === replacement[k]) && JSON.stringify(original.evidence||null)===JSON.stringify(replacement.evidence||null);
  }

  function current(record) {
    const h = history(record);
    return h.current || {stage: 'opportunity', outcome: 'none', occurred_at: null, verified_at: null, evidence_url: null,
      reason_kind: 'unknown', reason: '', next_action: record.next_action || '', blocker: record.blocker || '',
      resume_version: record.resume_version || '', at: null, corrected_by: null};
  }

  function work(record) {
    let details={match:'',gaps:'',resume_version:'',resume_sha256:'',answers_provenance:'',next_action:'',deadline:null}, claim=null;
    for(const e of record.events||[]) {
      if(e.kind==='work_details') details={...details,...e.details};
      if(e.kind==='claim') claim={id:e.claim_id,label:e.actor_label,actor_uid:e.actor_uid,recorded_at:e.recorded_at};
      if(e.kind==='release') claim=null;
    }
    return {details,claim};
  }
  function funnel(records) {
    const jobs=records.filter(r=>r.record_type!=='contact');
    const submitted=jobs.filter(r=>history(r).timeline.some(e=>e.stage==='submitted'&&hasEvidence(e)&&e.occurred_at));
    return {tracked:jobs.length,contacts:records.length-jobs.length,verified_submissions:submitted.length,
      historical_acknowledgments:submitted.filter(r=>history(r).timeline.some(e=>e.stage==='submitted'&&e.evidence?.kind==='historical_portal_acknowledgment')).length,
      interviews:submitted.filter(r=>history(r).timeline.some(e=>e.stage==='interview'&&e.evidence_url)).length,
      no_later_decision:submitted.filter(r=>current(r).outcome==='no_later_decision').length};
  }
  return Object.freeze({work,funnel,STAGES, OUTCOMES, SUBMISSION_STAGES, CLOSED_OUTCOMES, OUTCOMES_BY_STAGE, STATUS_FIELDS,
    LISTING_FIELDS, kindOf, stageRank, pick, normalizeRequisition, identityOf, listingKey, sameFact, history, conflict, correctionMaySubmit, current});
})();

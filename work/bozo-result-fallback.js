/* Result-only recovery for an already played game on the current, placed ticket.
 * Evidence is explicitly an authenticated manager attestation, not a server fetch.
 * No arbitrary paths, pick edits, ledger writes or week resolution are exposed. */
const BOZO_RESULT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    league: { type: "string" }, forUid: { type: "string", description: "Exact memberKey from dd_bozo_week." },
    revision: { type: "string", description: "resultRevision from the current leg read." },
    reason: { type: "string", minLength: 5, maxLength: 300 },
    evidence: { type: "object", additionalProperties: false, properties: {
      sourceUrl: { type: "string", description: "ESPN game URL for this exact event, inspected by the caller." },
      eventId: { type: "string" }, completed: { type: "boolean", const: true },
      status: { type: "string", enum: ["Final", "Final/OT"] },
      observedAt: { type: "string", description: "ISO time the caller verified the final score." },
      homeScore: { type: "integer", minimum: 0, maximum: 200 },
      awayScore: { type: "integer", minimum: 0, maximum: 200 },
      homeTeam: { type: "string" }, awayTeam: { type: "string" }
    }, required: ["sourceUrl", "eventId", "completed", "status", "observedAt", "homeScore", "awayScore", "homeTeam", "awayTeam"] },
    confirm: { type: "string", description: "Approved preview code. Repeat this exact code after an uncertain response; never create a new preview." }
  }, required: ["league", "forUid"],
  oneOf: [{ required: ["revision", "reason", "evidence"], not: { required: ["confirm"] } },
    { required: ["confirm"], not: { anyOf: ["revision", "reason", "evidence"].map(k => ({required:[k]})) } }]
};

async function bozoResultRevision(state, key) {
  return sha256hex(JSON.stringify(bozoCanonical({ season: state.season || SEASON,
    week: state.week || 1, status: state.status, pick: state.picks?.[key] || null,
    result: state.results?.[key] || null })));
}

function bozoResultGate(state, key, now) {
  if (state.status !== "placed" || state.bozo != null || state.gradeStartedWeek === (state.week || 1) || state.royale?.chops?.[state.week || 1])
    return "Only an unresolved placed ticket is supported; no week settlement is performed.";
  const p = state.picks?.[key], r = state.results?.[key];
  if (!p || !Object.hasOwn(state.members || {}, key)) return "Exact current memberKey required.";
  if (r?.result != null || r?.won != null || r?.actual != null || r?.resultSource === "manual")
    return "An existing grade or manual stamp is preserved. This tool fills missing results only.";
  if (!["nfl", "cfb"].includes(p.sport) || !["spread", "ml", "total"].includes(p.mkt) || bozoPeriodOf(p) !== "game")
    return "Only full-game NFL/CFB spread, moneyline and total legs are supported.";
  if (!(Date.parse(p.startsAt || p.commenceTime) < now)) return "Kickoff is future or unresolved.";
  if (p.mkt !== "ml" && (typeof p.line !== "number" || !Number.isFinite(p.line))) return "Stored line is unresolved.";
  if (p.mkt === "total" && !["over", "under"].includes(p.side)) return "Stored total selection is unresolved.";
  return null;
}

async function bozoResultEvidence(env, state, key, e, now) {
  const p = state.picks[key];
  if (!e || Array.isArray(e) || Object.keys(e).some(k => !Object.hasOwn(BOZO_RESULT_SCHEMA.properties.evidence.properties, k)) ||
      BOZO_RESULT_SCHEMA.properties.evidence.required.some(k => !Object.hasOwn(e, k))) throw new Error("Complete final-score evidence required.");
  const id = String(p.espnEventId || p.eventId || "");
  if (!/^\d+$/.test(id) || e.eventId !== id || e.completed !== true || !["Final", "Final/OT"].includes(e.status))
    throw new Error("Evidence must identify this exact completed event.");
  const observed = Date.parse(e.observedAt), start = Date.parse(p.startsAt || p.commenceTime);
  if (!Number.isFinite(observed) || observed < start || observed > now || now - observed > 30 * 60 * 1000)
    throw new Error("Verify the final score now; evidence must be within the last 30 minutes and after kickoff.");
  const url = new URL(e.sourceUrl);
  const sportPath = p.sport === "nfl" ? "nfl" : "college-football";
  if (url.origin !== "https://www.espn.com" || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith(`/${sportPath}/game/_/gameId/${id}/`)) throw new Error("Use the exact ESPN game source URL, without credentials or query parameters.");
  if (![e.homeScore,e.awayScore].every(n => Number.isInteger(n) && n >= 0 && n <= 200)) throw new Error("Both final scores must be integers from 0 to 200.");
  const doc = await bozoScheduleDoc(env, p.sport, state.season || SEASON);
  const game = bozoScheduleFindGame(doc, p);
  if (!game || String(game.espnEventId) !== id || !(Date.parse(game.startsAt) < now)) throw new Error("Schedule identity or kickoff is unresolved; no result was written.");
  const aliases = bozoBuildTeamRegistry(p.sport).aliases;
  const matches = (s, team) => typeof s === "string" && s.length > 0 && s.length <= 100 &&
    [team?.name,team?.abbr].some(t => t && bozoTeamNorm(s, aliases) === bozoTeamNorm(t, aliases));
  if (!matches(e.homeTeam,game.home) || !matches(e.awayTeam,game.away)) throw new Error("Evidence teams do not match the schedule's home and away teams.");
  if (game.completed === true && (game.homeScore !== e.homeScore || game.awayScore !== e.awayScore))
    throw new Error("Evidence disagrees with the cached official final; resolve the conflict manually.");
  const final = {...game, completed:true, homeScore:e.homeScore, awayScore:e.awayScore};
  const grade = bozoScheduledOutcome(p, final);
  if (grade.pending) throw new Error("The stored selection cannot be graded: " + grade.reason);
  const edge = p.mkt === "ml" ? grade.actual : p.mkt === "total" && p.side === "under" ? p.line - grade.actual : grade.actual - p.line;
  return {grade, arithmetic:{homeScore:e.homeScore,awayScore:e.awayScore,actual:grade.actual,
    line:p.mkt === "ml" ? null : p.line,edge,result:grade.result},
    evidence:{...e,verification:"manager_attested",scheduleSource:doc.source || null}};
}

async function bozoRecordResultCore(env, auth, body) {
  const reply = (body,status=200) => ({body,status});
  const fail = (error,status=409) => reply({error},status);
  if (!auth?.uid || auth.err) return fail("A personal authenticated account is required.",401);
  if (!body || Object.keys(body).some(k => !Object.hasOwn(BOZO_RESULT_SCHEMA.properties,k)) ||
      !validLeagueId(body.league || "") || typeof body.forUid !== "string" || !body.forUid) return fail("Supply league and exact forUid.",400);
  const confirming = body.confirm !== undefined, lid = body.league, key = body.forUid, actor = auth.uid;
  if (confirming ? (typeof body.confirm !== "string" || !/^[a-f0-9-]{36}$/.test(body.confirm) || ["revision","reason","evidence"].some(k => body[k] !== undefined))
    : (typeof body.revision !== "string" || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 300))
    return fail("Preview with revision, reason and evidence; confirm with only league, forUid and confirm.",400);
  const receiptFor = s => {
    const r = s?.audit?.[body.confirm];
    return r?.type === "record_result" && r.actor === actor && r.forUid === key && r.leagueId === lid ? r : null;
  };
  const readback = async (state, receipt) => ({ok:true, committed:true, confirmationId:receipt.confirmationId,
    league:lid,forUid:key,season:receipt.season,week:receipt.week,recorded:receipt.after,
    current:state.results?.[key] || null,resultRevision:await bozoResultRevision(state,key),
    matchesRecorded:(state.week || 1) === receipt.week && (state.season || SEASON) === receipt.season && bozoSame(state.results?.[key],receipt.after),
    arithmetic:receipt.arithmetic,audit:{at:receipt.at,actor:receipt.actor,reason:receipt.reason},
    status:state.status,scope:"result_and_audit_only"});
  try {
    const {data:state,etag} = await fbGet(env,LG(lid),true);
    if (!bozoCorrectionManager(state,auth)) return fail("Only a verified league manager, delegate or site administrator may record a result.",403);
    if (confirming && receiptFor(state)) return reply(await readback(state,receiptFor(state)));
    const gate = bozoResultGate(state,key,Date.now());
    if (gate) return fail(gate);
    if (!env.RL || !etag) return fail("Confirmation storage or concurrency token unavailable.",503);
    let pending;
    if (!confirming) {
      if (body.revision !== await bozoResultRevision(state,key)) return fail("The leg changed. Read dd_bozo_week again.");
      const verified = await bozoResultEvidence(env,state,key,body.evidence,Date.now());
      const code = crypto.randomUUID();
      pending = {code,actor,lid,key,revision:body.revision,reason:body.reason.trim(),evidenceInput:body.evidence,...verified,expiresAt:Date.now()+300000};
      await env.RL.put("bozoresult:"+actor+":"+lid+":"+code,JSON.stringify(pending),{expirationTtl:300});
      return reply({status:"confirm_required",confirm_code:code,expires_in:300,league:lid,forUid:key,
        season:state.season || SEASON,week:state.week || 1,selection:state.picks[key],before:state.results?.[key] || null,
        arithmetic:verified.arithmetic,evidence:verified.evidence,reason:pending.reason,
        echo:"Record only this missing historical result and audit. Evidence is manager-attested. No picks, prices, stakes, ledger, status, elimination or funding are changed.",
        writeTargets:["results/"+key,"audit/"+code]});
    }
    pending = JSON.parse(await env.RL.get("bozoresult:"+actor+":"+lid+":"+body.confirm) || "null");
    if (!pending || pending.actor !== actor || pending.lid !== lid || pending.key !== key || pending.expiresAt < Date.now()) return fail("Confirmation missing or expired.");
    if (pending.revision !== await bozoResultRevision(state,key)) return fail("The leg changed after preview; nothing was written.");
    // Recheck final identity/conflict gates; never silently change the approved arithmetic.
    const checked = await bozoResultEvidence(env,state,key,pending.evidenceInput,Date.now());
    if (!bozoSame(checked.grade,pending.grade)) return fail("The evidence changed after preview.");
    const before = state.results?.[key] || null, at = new Date().toISOString();
    const after = {...(before || {}),actual:pending.grade.actual,result:pending.grade.result,won:pending.grade.won,
      resultSource:"manual",resultEvidence:{...pending.evidence,reason:pending.reason,recordedAt:at,byUid:actor}};
    const receipt = {type:"record_result",confirmationId:body.confirm,actor,by:auth.name || null,at,leagueId:lid,forUid:key,
      season:state.season || SEASON,week:state.week || 1,path:"results/"+key,reason:pending.reason,before,after,arithmetic:pending.arithmetic};
    state.results = {...(state.results || {}),[key]:after};
    state.audit = {...(state.audit || {}),[body.confirm]:receipt};
    try {
      if (!await fbPut(env,LG(lid),state,etag)) return fail("Concurrent league change; retry the same confirmation after rereading.");
    } catch {
      // A response can be lost after the atomic commit. Same-code retry finds the receipt.
      return reply({error:"Commit outcome uncertain. Retry only the same confirmation code.",uncertain:true,confirm_code:body.confirm},503);
    }
    try {
      const fresh = (await fbGet(env,LG(lid))).data;
      if (!bozoCorrectionManager(fresh,auth)) return reply({committed:true,readbackVerified:false,confirmationId:body.confirm},200);
      if (!receiptFor(fresh)) return reply({committed:true,readbackVerified:false,confirmationId:body.confirm},200);
      return reply(await readback(fresh,receiptFor(fresh)));
    } catch { return reply({committed:true,readbackVerified:false,confirmationId:body.confirm},200); }
  } catch (e) { return fail(e.message,400); }
}

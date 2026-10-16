// Normalized internal contract v1. Not a claimed Kaggle schema.
export const convention = 'yards:x-right,y-up;degrees:counterclockwise-from-positive-x';
const fail = message => { throw new Error(message); };
const fields=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Unknown or malformed tracking fields');};
export function validateTracking(input) {
  const d = structuredClone(input);
  fields(d,['version','convention','split','provenance','frames']);
  if (!d || d.version !== 1 || d.convention !== convention) fail('Unsupported version or coordinate convention');
  if (!d.provenance || typeof d.provenance.source !== 'string' || !d.provenance.source.trim() ||
      !['synthetic','licensed'].includes(d.provenance.kind) || typeof d.provenance.note !== 'string') fail('Explicit provenance required');
  fields(d.provenance,['source','kind','note']);if(d.provenance.source.length>2000||d.provenance.note.length>4000)fail('Provenance too long');
  if (d.split !== 'discovery') fail('Held-out data is not accepted by the exploratory loader');
  if (!Array.isArray(d.frames) || !d.frames.length || d.frames.length > 10000) fail('Expected 1–10000 frames');
  const ids = new Set(); let previous = -Infinity;
  for (const f of d.frames) {
    fields(f,['sourceFrameId','timeMs','entities','events']);
    if (!f || typeof f.sourceFrameId !== 'string' || !f.sourceFrameId || f.sourceFrameId.length>100 || ids.has(f.sourceFrameId)) fail('Unique source frame IDs required');
    ids.add(f.sourceFrameId);
    if (!Number.isFinite(f.timeMs) || f.timeMs < 0 || f.timeMs <= previous) fail('Timestamps must increase; no fixed frame rate assumed');
    previous = f.timeMs;
    if (!Array.isArray(f.entities) || f.entities.length > 100) fail('Malformed entities');
    if (!Array.isArray(f.events) || f.events.length>100 || f.events.some(e => typeof e !== 'string' || e.length > 200)) fail('Events must be strings');
    const entities = new Set();
    for (const e of f.entities) {
      fields(e,['id','kind','cohort','x','y','speed','dir','o','missing']);
      if(e.missing!==undefined&&(!Array.isArray(e.missing)||e.missing.length>5||e.missing.some(k=>!['x','y','speed','dir','o'].includes(k))))fail('Malformed missing fields');
      if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 100 || entities.has(e.id)) fail('Unique entity IDs required per frame');
      entities.add(e.id);
      if (!['player','ball'].includes(e.kind) || typeof e.cohort !== 'string' || e.cohort.length > 100) fail('Entity kind/cohort required');
      e.missing = [];
      for (const [key, min, max] of [['x',0,120],['y',0,53.3333333334],['speed',0,30],['dir',0,360],['o',0,360]]) {
        if (e[key] === undefined) e[key] = null;
        if (e[key] === null) e.missing.push(key);
        else if (!Number.isFinite(e[key]) || e[key] < min || e[key] > max || (['dir','o'].includes(key) && e[key] === 360)) fail(`Invalid ${key} on ${e.id}`);
      }
    }
  }
  return d;
}
export function summarize(d) {
  // Descriptive frame observations, not independent samples or a fitted baseline.
  const groups = new Map();
  for (const f of d.frames) for (const e of f.entities) {
    if (e.kind !== 'player') continue;
    if (!groups.has(e.cohort)) groups.set(e.cohort, {cohort:e.cohort, observations:0, speeds:[], alignment:[], missing:0});
    const g = groups.get(e.cohort); g.observations++; g.missing += e.missing.length;
    if (e.speed !== null) g.speeds.push(e.speed);
    if (e.dir !== null && e.o !== null) g.alignment.push(Math.abs(((e.dir-e.o+540)%360)-180));
  }
  const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
  return [...groups.values()].map(g=>({cohort:g.cohort, observations:g.observations, speedCount:g.speeds.length,
    meanSpeed:mean(g.speeds), meanMotionBodyAngle:mean(g.alignment), missingFields:g.missing}));
}
export function syntheticTracking() {
  return validateTracking({version:1, convention, split:'discovery', provenance:{kind:'synthetic',source:'DataDawgs deterministic fixture v1',note:'Constructed motion. No real players, plays, outcomes or competition inference.'},
    frames:Array.from({length:40},(_,i)=>({sourceFrameId:`demo-${100+i*2}`,timeMs:i*100+(i>15?35:0),events:i===12?['synthetic release']:[],entities:[
      ...Array.from({length:8},(_,j)=>({id:`P${j+1}`,kind:'player',cohort:j<4?'Amber':'Verdigris',x:25+i*.6+j*2,y:8+j*5+Math.sin(i/5+j)*2,speed:i===7&&j===0?null:5+j*.15,dir:10+j*3,o:20+j*4})),
      {id:'ball',kind:'ball',cohort:'ball',x:28+i*.7,y:25,speed:null,dir:null,o:null}]}))});
}

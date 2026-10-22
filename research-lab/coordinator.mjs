// Tab-memory coordination only. Canonical tenant state remains the authority.
import {validateTracking} from './tracking.mjs';
export async function digest(value) {
  const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
const identity=s=>s?.identity?.tenant&&s?.identity?.actor?JSON.stringify([s.identity.tenant,s.identity.actor]):null;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const config=t=>({method:t.method,split:t.split,budgetMs:t.budgetMs,maxObservations:t.maxObservations});
export function taskState(s,t,now=Date.now()) {
  if(!t||!identity(s)||t.tenant!==s.identity.tenant||!/^[a-f0-9]{64}$/.test(s.codeHash))return 'unavailable';
  const h=s.hypotheses.find(h=>h.id===t.hypothesisId&&h.tenant===t.tenant);
  if(t.status==='stale'||!h||h.revisions.length!==t.hypothesisVersion||h.revisions.at(-1).status==='withdrawn')return 'stale';
  if(t.status==='completed')return 'unverified';
  if(!['queued','claimed'].includes(t.status))return 'unavailable';
  const check=t.dataCheckId&&s.discussions.find(d=>d.id===t.dataCheckId&&d.tenant===t.tenant);
  if(t.dataCheckId&&(!check||check.kind!=='data_check'||check.synthetic!==true||check.hypothesisId!==t.hypothesisId||check.codeHash!==s.codeHash||check.hypothesisVersion!==t.hypothesisVersion))return 'stale';
  if(t.lease){
    if(t.status!=='claimed'||!Number.isFinite(t.lease.expiresAt))return 'unavailable';
    if(t.lease.expiresAt<=now)return 'expired';
    if(t.lease.owner!==s.identity.actor)return 'foreign';
    return typeof t.lease.token==='string'&&/^\S+$/.test(t.lease.token)?'owned':'unavailable';
  }
  return t.status==='queued'?'queued':'unavailable';
}
export async function verifyReceipt(s,t,r,{dataHash,codeHash,actor}={}) {
  const fail=()=>{throw new Error('Receipt verification failed; completion is unverified.');};
  if(!identity(s)||!t||!r||t.tenant!==s.identity.tenant||r.tenant!==t.tenant||r.taskId!==t.id||r.hypothesisId!==t.hypothesisId||r.hypothesisVersion!==t.hypothesisVersion||r.split!==t.split||t.status!=='completed'||r.synthetic!==true||r.provenance?.kind!=='synthetic'||r.split!=='discovery'||!['success','null','inconclusive','failure'].includes(r.outcome))fail();
  const h=s.hypotheses.find(h=>h.id===t.hypothesisId&&h.tenant===t.tenant);
  if(!h||h.revisions.length!==t.hypothesisVersion||h.revisions.at(-1).status==='withdrawn')fail();
  if(s.receipts.filter(x=>x.taskId===t.id).length!==1||!s.receipts.some(x=>x.id===r.id&&x.receiptHash===r.receiptHash))fail();
  const {receiptHash,...body}=r;
  if(!/^[a-f0-9]{64}$/.test(receiptHash)||await digest(body)!==receiptHash||r.hashes?.config!==await digest(config(t))||r.hashes?.code!==s.codeHash||codeHash&&r.hashes.code!==codeHash||dataHash&&r.hashes.data!==dataHash||actor&&r.actor!==actor)fail();
  const check=t.dataCheckId&&s.discussions.find(d=>d.id===t.dataCheckId&&d.tenant===t.tenant);
  if(!check&&!dataHash)fail(); // Legacy receipts have no canonical input anchor after a reload.
  if(t.dataCheckId&&(!check||check.kind!=='data_check'||check.synthetic!==true||check.hypothesisId!==t.hypothesisId||check.hypothesisVersion!==t.hypothesisVersion||check.dataHash!==r.hashes.data||check.codeHash!==r.hashes.code))fail();
  if(!/^[a-f0-9]{64}$/.test(r.hashes?.data)||!/^[a-f0-9]{64}$/.test(r.hashes?.code))fail();
  return r;
}
export function createCoordinator(client,{now=Date.now,key=()=>crypto.randomUUID()}={}) {
  // No storage, tokens in URLs, or externally inspectable pending payloads.
  let generation=0,owner=null;const attempts=new Map(),flights=new Map(),verifiedInputs=new Map();
  const clear=()=>{generation++;owner=null;attempts.clear();flights.clear();verifiedInputs.clear();};
  const adopt=s=>{const next=identity(s);if(!next)throw new Error('Verified runner identity unavailable');if(owner&&owner!==next)clear();owner=next;};
  const current=g=>{if(g!==generation)throw new Error('Identity changed; pending attempt cleared');};
  const clock=()=>typeof now==='function'?now():now;
  async function execute(taskId,tracking){
    const start=generation;let s=await client.state();current(start);adopt(s);const g=generation;let t=s.tasks.find(t=>t.id===taskId);
    let a=attempts.get(taskId);
    if(!a){
      const payload=freeze(structuredClone(tracking));
      const checked=validateTracking(payload);
      if(checked.provenance.kind!=='synthetic'||checked.split!=='discovery')throw new Error('Synthetic discovery only; no execution authorized');
      a={tracking:payload,dataHash:await digest(payload),codeHash:s.codeHash,actor:s.identity.actor,claim:freeze({taskId,leaseMs:60000}),claimKey:key(),runKey:key(),run:null,status:'ready',sent:false};current(g);attempts.set(taskId,a);
    }
    const reconcile=async()=>{s=await client.state();current(g);if(identity(s)!==owner){clear();throw new Error('Identity changed; pending attempt cleared');}t=s.tasks.find(t=>t.id===taskId);};
    const receipt=async()=>{
      const rs=s.receipts.filter(r=>r.taskId===taskId);if(!rs.length)return null;
      const r=await verifyReceipt(s,t,rs[0],a);current(g);verifiedInputs.set(r.id,{dataHash:a.dataHash,codeHash:a.codeHash,actor:a.actor});attempts.delete(taskId);return {status:r.outcome==='failure'?'failed':'completed',receipt:r};
    };
    let done=await receipt();if(done)return done;
    let status=taskState(s,t,clock());
    if(!['queued','expired','owned'].includes(status))throw new Error('Task '+status+'; no execution authorized');
    const check=t.dataCheckId&&s.discussions.find(d=>d.id===t.dataCheckId&&d.tenant===t.tenant);
    if(s.codeHash!==a.codeHash||check&&check.dataHash!==a.dataHash)throw new Error('Input or implementation changed; recheck before execution');
    if(a.run&&status!=='owned')throw new Error('Pending run has no valid owned lease; reconcile before a new attempt');
    // This fresh canonical read found no receipt and an expired lease. A claim-only
    // retry may renew its key; an uncertain run must retain its original identity.
    if(status==='expired'&&a.sent&&!a.run)a.claimKey=key();
    if(status!=='owned'){
      a.sent=true;a.status='pending';
      let error;try{await client.command('claim',a.claim,a.claimKey);}catch(e){error=e;}
      current(g);await reconcile();done=await receipt();if(done)return done;
      status=taskState(s,t,clock());if(status!=='owned')throw error||new Error('Claim '+status+'; no execution authorized');
    }
    if(s.codeHash!==a.codeHash)throw new Error('Implementation changed during claim; no execution authorized');
    if(!a.run)a.run=freeze({taskId,leaseToken:t.lease.token,tracking:a.tracking});
    if(a.run.leaseToken!==t.lease.token)throw new Error('Lease changed; pending attempt cannot resume');
    a.sent=true;a.status='pending';
    let error;try{await client.command('run',a.run,a.runKey);}catch(e){error=e;}
    current(g);await reconcile();done=await receipt();if(done)return done;
    throw error||new Error('Run response pending; reconcile canonical state before retrying');
  }
  return {clear,verifyReceipt(s,t,r){return verifyReceipt(s,t,r,identity(s)===owner?verifiedInputs.get(r?.id):undefined);},pending:id=>attempts.get(id)?.status==='pending',attemptState:id=>attempts.get(id)?.status||null,run(taskId,tracking){
    if(flights.has(taskId))return flights.get(taskId);
    const start=generation;
    const promise=execute(taskId,tracking).catch(error=>{const a=attempts.get(taskId);if(a&&start===generation)a.status=error.status||!a.sent?'failed':'pending';throw error;});flights.set(taskId,promise);
    promise.finally(()=>{if(flights.get(taskId)===promise)flights.delete(taskId);}).catch(()=>{});return promise;
  }};
}

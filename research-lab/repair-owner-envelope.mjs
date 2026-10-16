// Approved one-time incident repair. No HTTP route, credential or schedule.
export const REPAIR_KEY='research-repair:v1:outer-envelope-20261016';
export const RECOVERY_KEY=REPAIR_KEY+':recovery';
const PATH='/researchLab/v1/tenants/jason-bdb',OWNER='u_y9Pgnfml5AlhtotzlailibDR',TTL=2592000;
const DEADLINE=Date.parse('2026-10-17T00:00:00Z');
const caps=['research:read','hypothesis:write','evidence:write','discussion:write','task:write','task:claim','experiment:run'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const stable=x=>JSON.stringify(x,(k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const ensure=(v,code)=>{if(!v)throw Error('Research repair '+code);};
async function hash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
export function validateOriginal(raw){
 ensure(typeof raw==='string'&&new TextEncoder().encode(raw).length<=1000000,'source type');
 let e;try{e=JSON.parse(raw);}catch{throw Error('Research repair source JSON');}
 ensure(object(e)&&stable(Object.keys(e).sort())===stable(['access','payload','version'])&&e.version===1,'envelope schema');
 ensure(object(e.access)&&stable(Object.keys(e.access))===stable(['users'])&&object(e.access.users)&&stable(Object.keys(e.access.users))===stable([OWNER]),'grant scope');
 const grant=e.access.users[OWNER];
 ensure(object(grant)&&stable(Object.keys(grant).sort())===stable(['capabilities','enabled','owner'])&&grant.enabled===true&&grant.owner===true&&stable(grant.capabilities)===stable(caps),'grant contents');
 ensure(typeof e.payload==='string','payload type');let p;try{p=JSON.parse(e.payload);}catch{throw Error('Research repair payload JSON');}
 ensure(object(p)&&object(p.state)&&p.state.version===1&&object(p.inputs),'payload schema');
 for(const k of ['hypotheses','evidence','discussions','tasks','receipts','audit','idempotency'])ensure(Array.isArray(p.state[k]),'state collections');
 return e; // Preserve the inner payload string byte-for-byte.
}
export async function repairOwnerEnvelope({env,fbGet,fbPut,backup,now=Date.now()}){
 if(now>=DEADLINE||env.RESEARCH_OWNER_UID!==OWNER||env.RESEARCH_LAB_ENABLED!=='true'||!env.RL)return {status:'inactive'};
 ensure(typeof backup==='function','backup verifier required');
 const kv=env.RL,done=await kv.get(REPAIR_KEY,'json');if(done?.status==='complete')return done;
 const current=await fbGet(env,PATH,true);ensure(current.etag,'missing ETag');
 let recovery=await kv.get(RECOVERY_KEY,'json'),original;
 if(typeof current.data==='string'){
  original=current.data;validateOriginal(original);
  if(recovery)ensure(recovery.original===original,'recovery mismatch');
  else{recovery={version:1,taken:new Date(now).toISOString(),original,sourceHash:await hash(original)};await kv.put(RECOVERY_KEY,JSON.stringify(recovery),{expirationTtl:TTL});}
 }else{
  // A lost response may follow successful CAS; resume only with recovery proof.
  if(!recovery)return {status:'native_without_repair'};
  original=recovery.original;
 }
 ensure(recovery.sourceHash===await hash(original),'recovery integrity');
 const repaired=validateOriginal(original);
 if(typeof current.data==='string')ensure(await fbPut(env,PATH,repaired,current.etag),'concurrent change');
 else ensure(stable(current.data)===stable(repaired),'changed after repair');
 const saved=await fbGet(env,PATH,true);ensure(saved.etag&&object(saved.data)&&stable(saved.data)===stable(repaired),'readback mismatch');
 ensure(saved.data.payload===repaired.payload,'payload mismatch');
 // Exact no-op save/reload proves conditional persistence without adding test data.
 ensure(await fbPut(env,PATH,saved.data,saved.etag),'save verification conflict');
 const reloaded=await fbGet(env,PATH,true);ensure(object(reloaded.data)&&stable(reloaded.data)===stable(repaired),'reload mismatch');
 const taken=new Date(now).toISOString(),snapshotKey='research-backup:v1:tenant:jason-bdb:'+taken.slice(0,10);
 await backup(now);
 const snapshot=await kv.get(snapshotKey,'json');
 ensure(snapshot&&stable(snapshot.record)===stable(reloaded.data),'backup readback mismatch');
 const receipt={version:1,status:'complete',taken,nativeObject:true,conditionalSaveReload:true,payloadIdentical:true,grantsIdentical:true,sourceHash:await hash(original),payloadHash:await hash(repaired.payload),recordHash:await hash(stable(reloaded.data)),snapshotKey,recoveryKey:RECOVERY_KEY,retentionSeconds:TTL};
 await kv.put(REPAIR_KEY,JSON.stringify(receipt),{expirationTtl:TTL});return receipt;
}

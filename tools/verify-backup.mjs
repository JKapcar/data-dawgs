// Read-only; production payloads exist only in memory. Never emit records or keys
// containing owner/client identifiers. This validates copies, never restores data.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const check=(v)=>{if(!v)throw Error('Backup verification failed');};
export function decodeBackup(bytes) {
  let value=JSON.parse(bytes.toString('utf8'));
  if(value.format!==undefined){
    check(value.format==='dd-backup-gzip-v1'&&typeof value.payload==='string');
    const raw=gunzipSync(Buffer.from(value.payload,'base64'),{maxOutputLength:128*1024*1024});
    check(raw.length===value.uncompressedBytes&&createHash('sha256').update(raw).digest('hex')===value.sha256);
    const decoded=JSON.parse(raw.toString('utf8'));check(decoded.taken===value.taken);value=decoded;
  }
  check(typeof value.taken==='string'&&Number.isFinite(Date.parse(value.taken))&&value.db&&typeof value.db==='object'&&!Array.isArray(value.db));
  return value;
}
export async function verifyBackup() {
  const headers={Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN};
  const base='https://api.cloudflare.com/client/v4';
  async function get(path){const r=await fetch(base+path,{headers,redirect:'error'});check(r.ok);return r;}
  const accounts=await(await get('/accounts')).json();check(accounts.success&&accounts.result.length===1);
  const root='/accounts/'+accounts.result[0].id+'/storage/kv/namespaces/ffee9157b0a04cebb796acfa6046880a';
  const value=async key=>Buffer.from(await(await get(root+'/values/'+encodeURIComponent(key))).arrayBuffer());
  const latest=await value('backup:latest'),decoded=decodeBackup(latest),day=decoded.taken.slice(0,10);
  const dated=await value('backup:'+day);check(latest.equals(dated));decodeBackup(dated);
  const excluded=['privatePounds','privateJobs','researchLab','researchUploads','researchProjects'];
  check(excluded.every(k=>!Object.hasOwn(decoded.db,k)));
  const summary={checkedAt:new Date().toISOString(),taken:decoded.taken,storedBytes:latest.length,format:JSON.parse(latest).format||'legacy-json',uncompressedBytes:JSON.parse(latest).uncompressedBytes||latest.length,generalCopiesIdentical:true,validJSON:true,checksumVerified:JSON.parse(latest).format==='dd-backup-gzip-v1',rootSections:Object.keys(decoded.db).length,usersPresent:Object.hasOwn(decoded.db,'users'),privateSectionsExcluded:true,privateFamilies:{}};
  for(const prefix of ['pound-backup:','jobs-backup:','research-backup:']){
    let cursor='',keys=[];
    do{const j=await(await get(root+'/keys?prefix='+encodeURIComponent(prefix)+'&limit=1000'+(cursor?'&cursor='+encodeURIComponent(cursor):''))).json();check(j.success);keys.push(...j.result);cursor=j.result_info?.cursor||'';}while(cursor);
    const current=keys.filter(k=>k.name.endsWith(':'+day)),types={};let bytes=0;
    for(const key of current){const raw=await value(key.name),v=JSON.parse(raw),record=v.workspace||v.record;check(v.version===1&&v.taken===decoded.taken&&record&&typeof record.payload==='string'&&key.expiration>Date.now()/1000);JSON.parse(record.payload);if(v.workspace)check(record.owner_uid===v.owner_uid);bytes+=raw.length;const type=v.kind||'workspace';check(['workspace','tenant','upload','project'].includes(type));types[type]=(types[type]||0)+1;}
    summary.privateFamilies[prefix]={count:current.length,bytes,types,validJSON:true,sameSnapshotTime:true,expiryPresent:true};
  }
  return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await verifyBackup(),null,2));}catch{console.error('Backup verification failed; no private contents emitted.');process.exitCode=1;}
}

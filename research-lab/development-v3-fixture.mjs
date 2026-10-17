// Synthetic test fixture only. No private records or live credentials.
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readDevelopmentData,SOURCE_SHA} from './development-data.mjs';
globalThis.crypto??=webcrypto;
export const canonicalSelector=s=>JSON.stringify(Object.fromEntries(Object.keys(s).sort().map(k=>[k,s[k]])));
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function v3Fixture(){
 const objects=new Map(),reads=[];
 const put=(value,extension='json')=>{const raw=extension==='json'?Buffer.from(JSON.stringify(value)):Buffer.from(value),hash=sha(raw);objects.set(hash+'.'+extension,raw);return hash;};
 const table='game_tracking',policy='wr-draft-season-reg-v1';
 const selector={season:'2023',season_type:'REG',game_id:'game',play_id:'play',nfl_id:'wr'};
 const fields=Object.keys(selector);
 const columns=['game_id','play_id','nfl_id','time','dd_season','dd_season_type','dd_draft_year','dd_nfl_position'];
 const row=(id,time)=>({game_id:'game',play_id:'play',nfl_id:id,time:String(time),dd_season:'2023',dd_season_type:'REG',dd_draft_year:'2023',dd_nfl_position:'WR'});
 const rows=[row('adjacent',0),...Array.from({length:201},(_,i)=>row('wr',i))];
 const artifact={version:3,sourceSha256:SOURCE_SHA,policy,table,columns,rows};
 const raw=Buffer.from(JSON.stringify(artifact)),compressed=gzipSync(raw);
 const descriptor={sha256:put(compressed,'gz'),decodedSha256:sha(raw),compressedBytes:compressed.length,decodedBytes:raw.length,rows:rows.length,start:1,count:201};
 const entries=[];
 for(let i=0;i<=fields.length;i++){
  const s=Object.fromEntries(fields.slice(0,i).map(k=>[k,selector[k]]));
  entries.push({key:sha(canonicalSelector(s)),selector:s,kind:i===fields.length?'shards':'children',rows:i===fields.length?201:null,values:i===fields.length?[descriptor]:[Object.fromEntries(fields.slice(0,i+1).map(k=>[k,selector[k]]))]});
 }
 const node={version:3,kind:'lookup',sourceSha256:SOURCE_SHA,table,entries};
 const root=put(node);
 const tables=Object.fromEntries(['players','combine_results','combine_tracking','games','player_play','game_tracking'].map(t=>[t,{root,rows:201,partitions:1,selector:t==='games'?['season','season_type','game_id']:['player_play','game_tracking'].includes(t)?fields:['draft_year','nfl_id'],columns:columns.map(name=>({name}))}]));
 const manifest={version:3,sourceSha256:SOURCE_SHA,policy,classes:['2023','2024'],seasons:['2023','2024'],holdoutRead:false,tables};
 const env={RESEARCH_DEVELOPMENT_DATA_ENABLED:'true',RESEARCH_DEVELOPMENT_MANIFEST_SHA:put(manifest),RESEARCH_UPLOAD_TENANT:'synthetic',RESEARCH_UPLOADS:{async get(key){reads.push(key);const raw=objects.get(key.split('/').at(-1));return raw?{size:raw.length,body:new Response(raw).body}:null;}}};
 function repin(){tables.game_tracking.root=put(node);env.RESEARCH_DEVELOPMENT_MANIFEST_SHA=put(manifest);}
 return {objects,reads,put,env,selector,descriptor,artifact,node,manifest,repin,call:args=>readDevelopmentData(env,'owner',args)};
}

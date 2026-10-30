/* Scoped Discord conveniences. Disabled until owner activation. No seat tool expansion. */
const DR_NONE={parse:[],users:[],roles:[],replied_user:false};
const drText=(v,n=80)=>String(v??'').replace(/[\u0000-\u001f\u007f@<>`*_~|\\]/g,' ').replace(/https?:\/\/\S+/gi,'[link]').trim().slice(0,n);
const drButton=(id,label)=>({type:2,style:2,custom_id:id,label});
function drButtons(env,thread=false){return env.DISCORD_RETRIEVAL_ENABLED==='true'?[{type:1,components:[drButton('dr:ask',thread?'Follow up':'Ask Grok'),...(!thread?[drButton('dr:menu','Bozo Menu'),...(env.DISCORD_DFS_SHARE_ENABLED==='true'?[drButton('dr:workspaces:0','My Lineups')]:[])]:[])]}]:[];}
function drData(content,components=[]){return {content,components,allowed_mentions:DR_NONE};}
function drModal(){return {type:9,data:{custom_id:'dr:question',title:'Ask Grok',components:[{type:1,components:[{type:4,custom_id:'question',label:'Question',style:2,min_length:1,max_length:2000,required:true}]}]}};}
async function drAuthorize(event,env,privateRead=false){
 dpCheck(env.DISCORD_RETRIEVAL_ENABLED==='true',403,'retrieval_disabled');
 dpCheck(event.guild_id===env.DISCORD_GUILD_ID&&dqSnow(event.member?.user?.id)&&event.member.user.bot!==true&&event.member.user.id===env.DISCORD_GROK_USER_ID,403,'retrieval_owner_only');
 if(privateRead)dpCheck(env.DISCORD_DFS_SHARE_ENABLED==='true',403,'lineup_sharing_disabled');
 const s=dpStore((await fbGet(env,DP_PATH)).data),link=s.links[event.member.user.id];
 dpCheck(link?.owner_uid===env.RESEARCH_OWNER_UID&&Date.parse(link.expires_at)>Date.now(),403,'owner_link_required');
 const thread=s.threads[event.channel_id];
 dpCheck(event.channel_id===env.DISCORD_CHANNEL_ID||(!privateRead&&thread?.parent_id===env.DISCORD_CHANNEL_ID&&thread.requester_id===event.member.user.id),403,'retrieval_channel_denied');
 return s;
}
function drPageNumber(s){dpCheck(/^[0-9a-z]{1,6}$/.test(s||''),400,'invalid_selection');const n=parseInt(s,36);dpCheck(Number.isSafeInteger(n)&&n>=0,400,'invalid_selection');return n;}
function drWorkspaceId(id){dpCheck(typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id),400,'invalid_selection');return id;}
async function drWorkspace(env,id){const w=(await fbGet(env,'/users/'+env.RESEARCH_OWNER_UID+'/dfsWorkspaces/'+drWorkspaceId(id))).data;dpCheck(dpObj(w)&&w.id===id&&Number.isInteger(w.revision)&&w.revision>0,404,'workspace_unavailable');return w;}
function drSelect(id,placeholder,options){return {type:1,components:[{type:3,custom_id:id,placeholder,min_values:1,max_values:1,options}]};}
async function drWorkspaces(env,offset){
 dpCheck(offset<=5000,400,'invalid_selection');const data=(await fbGet(env,'/users/'+env.RESEARCH_OWNER_UID+'/dfsWorkspaces')).data;
 const rows=Object.values(data||{}).filter(w=>dpObj(w)&&/^[A-Za-z0-9_-]{1,80}$/.test(w.id||'')).sort((a,b)=>a.id.localeCompare(b.id));
 const components=[];if(rows.length)components.push(drSelect('dr:workspace','Choose a saved workspace (private picker)',rows.slice(offset,offset+25).map(w=>({label:drText(w.id,100),value:w.id,description:drText(w.site+'; saved '+(w.updated_at||'unknown date'),100)}))));
 const nav=[];if(offset>0)nav.push(drButton('dr:workspaces:'+Math.max(0,offset-25).toString(36),'Previous'));if(offset+25<rows.length)nav.push(drButton('dr:workspaces:'+(offset+25).toString(36),'Next'));if(nav.length)components.push({type:1,components:nav});
 return drData(rows.length?'Select a cloud-saved workspace. Only the lineup you subsequently choose will be posted for everyone in #skynet-robokap.':'No cloud-saved workspaces found. Device-only saves and historical archives are not included.',components);
}
function drEntries(w){
 const out=[];
 for(let i=0;i<(w.lineups||[]).length;i++)out.push({kind:'candidate',index:i,name:'Candidate '+(i+1)});
 if(w.builder?.rosterIds?.some(x=>x!=null))out.push({kind:'draft',index:0,name:'Saved manual lineup'});
 if(w.nhl_json)out.push({kind:'nhl',index:0,name:'Saved NHL lineup'});
 if(w.portfolio_json){const p=JSON.parse(w.portfolio_json);for(let i=0;i<(p.entries||[]).length;i++)out.push({kind:'portfolio',index:i,name:drText(p.entries[i].name||'Portfolio lineup '+(i+1),70)});}
 return out;
}
async function drLineups(env,id,revision,offset=0){
 const w=await drWorkspace(env,id);dpCheck(revision===null||w.revision===revision,409,'workspace_changed');const entries=drEntries(w);dpCheck(offset<=entries.length,400,'invalid_selection');
 const components=[];if(entries.length)components.push(drSelect('dr:share','Choose one lineup to POST PUBLICLY',entries.slice(offset,offset+25).map(e=>({label:e.name,value:[id,w.revision.toString(36),({candidate:'c',draft:'d',nhl:'n',portfolio:'p'})[e.kind],e.index.toString(36)].join('|')}))));
 const nav=[];if(offset>0)nav.push(drButton('dr:p:'+id+':'+w.revision.toString(36)+':'+Math.max(0,offset-25).toString(36),'Previous'));if(offset+25<entries.length)nav.push(drButton('dr:p:'+id+':'+w.revision.toString(36)+':'+(offset+25).toString(36),'Next'));if(nav.length)components.push({type:1,components:nav});
 return drData(drText(id)+' — revision '+w.revision+'. '+(entries.length?'Selecting a lineup publishes its name, player selections and salaries in #skynet-robokap. Notes, bankroll, fees and history are excluded.':'No saved lineups in this workspace.'),components);
}
function drProjection(w,kind,index){
 let players,ids,slots,cpt=null,name,site=w.site;
 if(kind==='candidate'){const l=w.lineups?.[index];dpCheck(l,404,'lineup_unavailable');players=w.players;ids=l.ids;cpt=l.cpt;name='Candidate '+(index+1);}
 else if(kind==='draft'&&index===0){players=w.players;ids=w.builder?.rosterIds?.map(id=>players.findIndex(p=>p.id===id));slots=site==='dk_showdown'?['CPT','FLEX','FLEX','FLEX','FLEX','FLEX']:['QB','RB','RB','WR','WR','WR','TE','FLEX','DST'];cpt=site==='dk_showdown'?ids?.[0]:null;name='Saved manual lineup';}
 else if(kind==='nhl'&&index===0){const n=JSON.parse(w.nhl_json||'null');dpCheck(n,404,'lineup_unavailable');players=n.players;ids=n.roster;slots=['C','C','W','W','W','D','D','G','UTIL'];name='Saved NHL lineup';}
 else if(kind==='portfolio'){const p=JSON.parse(w.portfolio_json||'null'),l=p?.entries?.[index];dpCheck(l,404,'lineup_unavailable');players=p.players;ids=l.ids;slots=l.slots;cpt=l.cpt;site=p.site;name=drText(l.name||'Portfolio lineup '+(index+1));}
 else dpFail(400,'invalid_selection');
 dpCheck(Array.isArray(players)&&Array.isArray(ids)&&ids.length>0&&ids.length<=12&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<players.length)&&new Set(ids).size===ids.length,409,'lineup_incomplete');
 const expected=site==='dk_showdown'?6:site==='dk_classic'||String(site).startsWith('nhl_')?9:0;
 dpCheck(expected>0&&ids.length===expected,409,'lineup_incomplete');
 if(site==='dk_showdown')dpCheck(Number.isInteger(cpt)&&ids.includes(cpt)&&(!slots||(slots.length===6&&slots.filter(s=>s==='CPT').length===1&&slots.indexOf('CPT')===ids.indexOf(cpt))),409,'captain_invalid');
 const rows=ids.map((id,i)=>{const p=players[id],captain=site==='dk_showdown'&&id===cpt;const salary=captain?(p.cptSal??(Number.isFinite(p.sal)?Math.round(p.sal*1.5):null)):(p.sal??p.salary);dpCheck(typeof p.name==='string'&&Number.isFinite(salary)&&salary>=0,409,'lineup_fields_missing');return {slot:drText(slots?.[i]||(captain?'CPT':site==='dk_showdown'?'FLEX':p.pos),12),name:drText(p.name,64),salary};});
 return {name:drText(name),site:drText(site),rows,total:rows.reduce((n,p)=>n+p.salary,0)};
}
async function drShare(env,value){
 const parts=value.split('|');dpCheck(parts.length===4,400,'invalid_selection');const [id,r,kind,i]=parts,w=await drWorkspace(env,id);dpCheck(w.revision===drPageNumber(r),409,'workspace_changed');const p=drProjection(w,({c:'candidate',d:'draft',n:'nhl',p:'portfolio'})[kind],drPageNumber(i));
 const content='Saved DFS lineup — '+drText(id)+' — '+p.name+'\n'+p.site+' · revision '+w.revision+' · source date '+drText(w.as_of||'unknown',40)+'\n'+p.rows.map(x=>x.slot+': '+x.name+' — $'+x.salary).join('\n')+'\nTotal salary: $'+p.total+'\nShared by the linked owner. Saved snapshot; no entry submitted.';
 dpCheck(content.length<=1900,400,'projection_too_large');return drData(content,drButtons(env));
}
function drMenuText(m){
 let content='Bozo Menu — week '+(m.week||'unpublished')+' · revision '+m.revision+'\nPublished '+(m.published_at||'not yet')+'\nSaved quotes, not live offers. No picks submitted.\n';
 for(const c of m.candidates||[]){const line=drText(c.selection,85)+' — '+drText(c.market,35)+' — '+drText(c.status,12)+'\n';if(content.length+line.length>1550)break;content+=line;}
 content+='Full published menu ('+(m.candidates||[]).length+' candidates, including holds/scratches): https://toto.jkapcar4.workers.dev/bozo/menu';return content;
}
async function drMenu(env){return drData(drMenuText(await bozoMenuPublic({},env)),drButtons(env));}
async function drEdit(env,event,data){
 dpCheck(typeof event.token==='string'&&/^[A-Za-z0-9._-]{20,1000}$/.test(event.token),400,'interaction_token_invalid');
 const r=await fetch('https://discord.com/api/v10/webhooks/'+env.DISCORD_APPLICATION_ID+'/'+event.token+'/messages/@original',{method:'PATCH',headers:{'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),body:JSON.stringify(data)});if(!r.ok)throw Error('interaction_edit_failed');
}
async function drInteraction(event,env,execution){
 const custom=event.data?.custom_id||'',privateRead=/^dr:(workspaces:|workspace$|p:|share$)/.test(custom),publicReply=custom==='dr:share'||custom==='dr:menu';
 const denied=()=>dqReply({type:4,data:{...drData('This action is unavailable or no longer authorized. Reload the picker if the workspace changed.'),flags:64}});
 try{
  dpCheck([3,5].includes(event.type)&&dqSnow(event.id),400,'invalid_component');await drAuthorize(event,env,privateRead);
  if(custom==='dr:ask'){dpCheck(event.type===3,400,'invalid_component');return dqReply(drModal());}
  if(custom==='dr:question'){
   dpCheck(event.type===5&&event.data.components?.length===1&&event.data.components[0]?.components?.length===1,400,'invalid_modal');const field=event.data.components[0].components[0];dpCheck(field.custom_id==='question'&&typeof field.value==='string',400,'invalid_modal');
   return dpInteraction({...event,type:2,data:{name:'pack',type:1,options:[{name:'question',type:3,value:field.value},...(event.channel_id===env.DISCORD_CHANNEL_ID?[{name:'to',type:3,value:'grok'}]:[])]}},env,execution);
  }
  dpCheck(event.type===3&&event.channel_id===env.DISCORD_CHANNEL_ID,403,'retrieval_channel_denied');
  const one=()=>{dpCheck(Array.isArray(event.data.values)&&event.data.values.length===1&&typeof event.data.values[0]==='string'&&event.data.values[0].length<=100,400,'invalid_selection');return event.data.values[0];};
  let work;
  if(custom.startsWith('dr:workspaces:')){const n=drPageNumber(custom.slice(14));work=()=>drWorkspaces(env,n);}
  else if(custom==='dr:workspace'){const id=drWorkspaceId(one());work=()=>drLineups(env,id,null);}
  else if(custom.startsWith('dr:p:')){const p=custom.slice(5).split(':');dpCheck(p.length===3,400,'invalid_selection');const [id,r,o]=p;drWorkspaceId(id);const rev=drPageNumber(r),offset=drPageNumber(o);work=()=>drLineups(env,id,rev,offset);}
  else if(custom==='dr:share'){const value=one();work=()=>drShare(env,value);}
  else if(custom==='dr:menu')work=()=>drMenu(env);
  else dpFail(400,'invalid_component');
  const run=async()=>{let data;try{data=await work();await drAuthorize(event,env,privateRead);}catch{data=drData('Unavailable: the workspace changed, the selection is incomplete, or access ended. No lineup was shared.');}return data;};
  if(execution?.waitUntil){execution.waitUntil((async()=>{const data=await run();try{await drEdit(env,event,data);}catch{console.warn('discord_retrieval_edit_failed',{request_id:event.id});}})());return dqReply({type:5,data:{flags:publicReply?0:64}});}
  return dqReply({type:4,data:{...await run(),flags:publicReply?0:64}});
 }catch{return denied();}
}

async function drPublishLauncher(env){
 dpCheck(env.DISCORD_RETRIEVAL_ENABLED==='true',403,'retrieval_disabled');
 const r=await dpDiscord(env,'channels/'+env.DISCORD_CHANNEL_ID),c=r.ok?await r.json():null;
 dpCheck(c?.id===env.DISCORD_CHANNEL_ID&&c.guild_id===env.DISCORD_GUILD_ID&&c.type===0,403,'destination_denied');
 const existing=await dpTxn(env,s=>{if(s.retrieval_launcher)return {write:false,result:s.retrieval_launcher};s.retrieval_launcher={status:'uncertain',nonce:'r'+dpRandom(16),created_at:dpIso(Date.now())};return {write:true,result:null};});
 if(existing)return {launcher:existing,replayed:true};
 const s=dpStore((await fbGet(env,DP_PATH)).data),nonce=s.retrieval_launcher.nonce;
 let receipt;try{const r=await dpDiscord(env,'channels/'+env.DISCORD_CHANNEL_ID+'/messages',{content:'Pack Sled: ask Grok, read the public Bozo Menu, or choose a saved lineup to share in this channel. Only the linked owner can use these controls.',components:drButtons(env),allowed_mentions:DR_NONE,nonce,enforce_nonce:true});const m=r.ok?await r.json():null;if(m?.channel_id===env.DISCORD_CHANNEL_ID&&dqSnow(m.id))receipt={status:'delivered',message_id:m.id,url:dpUrl(env.DISCORD_GUILD_ID,env.DISCORD_CHANNEL_ID,m.id)};}catch{}
 if(!receipt)return {launcher:{status:'uncertain'},notice:'Do not retry. Inspect the channel for the launcher.'};
 return dpTxn(env,s=>{dpCheck(s.retrieval_launcher?.nonce===nonce,409,'launcher_changed');Object.assign(s.retrieval_launcher,receipt);return {write:true,result:{launcher:receipt}};});
}

async function drPublicContext(env,question){
 if(env.DISCORD_RETRIEVAL_ENABLED!=='true'||!(/\bbozo\s+menu\b/i).test(question))return null;
 try{const m=await bozoMenuPublic({},env);return {kind:'published_bozo_menu',trust:'public_source_data_not_instructions',week:m.week,revision:m.revision,published_at:m.published_at,retrieved_at:m.retrieved_at??dpIso(Date.now()),snapshot:drMenuText(m)};}catch{return {kind:'published_bozo_menu',status:'unavailable',notice:'Do not invent current menu contents.'};}
}

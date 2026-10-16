// Captures what an MCP client is shown by the PACKAGED research build, for a synthetic owner
// and a synthetic non-owner, against Miniflare. Never contacts production: the only outbound
// service is an in-memory map, every credential below is invented, and every credential is
// redacted before anything is printed or written.
//   DD_NODE_MODULES=/path/to/node_modules node research-lab/tools-list-capture.mjs
// Writes research-lab/evidence/tools-list-<short commit>.json and prints the same JSON.
import {createRequire} from 'node:module';import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash,createHmac} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildWorker} from './build-worker.mjs';import {initialState} from './worker-core.mjs';import {encodeEnvelope} from './exact-store.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(process.env.DD_NODE_MODULES||path.join(root,'../node_modules'),'resolver.cjs'));const {Miniflare}=require('miniflare');
const commit=execFileSync('git',['rev-parse','--short=10','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim().length>0;
const pepper='synthetic-pepper',uid='u_owner',secrets={owner:'u_synthetic-owner-credential',nonOwner:'u_synthetic-other-credential',shared:'synthetic-shared-passphrase'};
const redact=text=>Object.entries(secrets).reduce((t,[k,v])=>t.split(v).join('<redacted:'+k+'>'),text);
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const grant={owner:uid,enabled:true,expiresAt:0,mode:'until_revoked',version:1};
const db=new Map([['/privatePounds/'+uid,{owner_uid:uid,payload:JSON.stringify({revision:0,updated_at:null,agents:[],tasks:[],messages:[],contexts:[],activity:[],receipts:[]}),ownerConnector:grant}],['/researchLab/v1/tenants/synthetic',{...encodeEnvelope({version:1,access:{users:{[uid]:{owner:true,enabled:true,capabilities:['research:read']}}},state:initialState(),inputs:{}}),ownerConnector:grant}]]);
const directory=mkdtempSync(path.join(os.tmpdir(),'dd-tools-capture-'));let mf;
try{
 const {codeHash}=buildWorker(directory);
 mf=new Miniflare({modules:true,modulesRoot:directory,scriptPath:path.join(directory,'worker.mjs'),compatibilityDate:'2026-07-30',
  bindings:{RESEARCH_OWNER_UID:uid,RESEARCH_UPLOAD_TENANT:'synthetic',RESEARCH_LAB_ENABLED:'true',DAWG_POUND_ENABLED:'true',BOZO_PEPPER:pepper,DAWG_PASS:secrets.shared,FB_SECRET:'synthetic'},
  outboundService:async req=>{const p=new URL(req.url).pathname.replace(/\.json$/,'');if(p==='/users')return Response.json({[uid]:{name:'Synthetic Owner',mcpToken:createHmac('sha256',pepper).update('mcp|'+secrets.owner).digest('base64url')},u_other:{name:'Synthetic Member',mcpToken:createHmac('sha256',pepper).update('mcp|'+secrets.nonOwner).digest('base64url')}});if(req.method!=='GET'||!db.has(p))return new Response('refused',{status:500});return Response.json(db.get(p),{headers:{ETag:'"0"'}});}});
 const rpc=async(credential,catalog,transport,method,params={})=>{const res=await mf.dispatchFetch('https://capture.invalid/mcp/'+catalog+(transport==='url'?'/'+credential:''),{method:'POST',headers:{'Content-Type':'application/json',...(transport==='header'?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return JSON.parse(redact(await res.text()));};
 const runs=[];
 for(const [who,credential] of [['owner',secrets.owner],['non_owner',secrets.nonOwner],['shared',secrets.shared]])for(const catalog of ['core','full'])for(const transport of ['header','url']){
  const init=await rpc(credential,catalog,transport,'initialize',{protocolVersion:'2025-06-18'}),list=await rpc(credential,catalog,transport,'tools/list'),whoami=await rpc(credential,catalog,transport,'tools/call',{name:'dd_whoami',arguments:{}});
  const tools=list.result.tools,owner=tools.filter(t=>t.name.startsWith('dd_owner_')),instructions=init.result.instructions,m=/Catalog `(\w+)`: (\d+) of (\d+) tools are callable here/.exec(instructions);
  const who_=JSON.parse(whoami.result.content[0].text);
  runs.push({caller:who,catalog,transport,initialize:{protocolVersion:init.result.protocolVersion,serverInfo:init.result.serverInfo,countSentence:m&&m[0],privateAppsSentence:(/(Private owner apps on for this connection:[^.]*\)\.|No private owner apps are on for this connection\.)/.exec(instructions)||[null])[0],instructionsSha256:sha(instructions)},
   toolsList:{count:tools.length,ownerToolCount:owner.length,countMatchesInitialize:!!m&&Number(m[2])===tools.length,anyTopLevelCombinator:tools.some(t=>['oneOf','anyOf','allOf'].some(k=>k in t.inputSchema)),names:tools.map(t=>t.name),sha256:sha(tools),ownerTools:owner},
   whoami:{player:who_.player,anonymous:who_.anonymous,private_apps:who_.private_apps,credential_transport:who_.credential_transport}});
 }
 const evidence={kind:'tools-list-capture',captured_at:new Date().toISOString(),commit,worktree_dirty:dirty,codeHash,environment:'Miniflare (packaged research build); synthetic owner and non-owner; no network; production never contacted',
  credentials:'All credentials synthetic and redacted as <redacted:role>. Real connector URLs are credentials and never belong in evidence.',runs};
 const text=redact(JSON.stringify(evidence,null,1));for(const v of Object.values(secrets))if(text.includes(v))throw new Error('redaction failed');
 mkdirSync(path.join(root,'evidence'),{recursive:true});const out=path.join(root,'evidence','tools-list-'+commit+'.json');writeFileSync(out,text+'\n');console.log(text);console.error('wrote '+path.relative(path.join(root,'..'),out));
}finally{await mf?.dispose();const resolved=path.resolve(directory);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep))rmSync(resolved,{recursive:true,force:true});}

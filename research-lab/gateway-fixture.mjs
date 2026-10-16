import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
import {createResearchGateway} from './gateway.mjs';
import {initialState,transition,view,hash,capabilities} from './machine.mjs';
// Execute the current repository's actual signed-session/MCP validators and RTDB
// plumbing. Only the HTTP database is replaced by an in-memory ETag test double.
const source=readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
export async function fixture(){
 const env={RESEARCH_LAB_ENABLED:'true',FB_SECRET:'test-only',BOZO_PEPPER:'synthetic-test-pepper'},rows=new Map(),versions=new Map();let writes=0,onPut=null;
 const put=(path,value)=>{rows.set(path,structuredClone(value));versions.set(path,(versions.get(path)||0)+1);};
 const access={users:{u_owner:{enabled:true,expiresAt:Date.now()+600000,capabilities:['research:read',...capabilities]}},agents:{u_agent:{enabled:true,expiresAt:Date.now()+600000,capabilities:['research:read','task:claim','experiment:run','discussion:write']}}};
 put('/researchLab/v1/tenants/demo',{version:1,access,state:initialState(),inputs:{}});put('/users/u_owner',{name:'Owner',passwordSetAt:0});
 const fetch=async(url,options={})=>{const path=new URL(url).pathname.replace(/\.json$/,''),etag='"'+(versions.get(path)||0)+'"';
  if(options.method==='PUT'){if(onPut){const fn=onPut;onPut=null;fn();}if(options.headers['if-match']!=='"'+(versions.get(path)||0)+'"')return new Response('',{status:412});const next=JSON.parse(options.body);if(JSON.stringify(next.state)!==JSON.stringify(rows.get(path)?.state))writes++;put(path,next);return Response.json(rows.get(path));}
  return Response.json(rows.get(path)||null,{headers:{ETag:etag}});
 };
 const context=vm.createContext({Request,Response,URL,TextEncoder,TextDecoder,Uint8Array,Date,crypto:webcrypto,fetch,btoa,atob,encodeURIComponent,
  te:new TextEncoder(),SESSION_DAYS:30,DB:'https://db.invalid',b64:bytes=>Buffer.from(bytes).toString('base64'),b64urlStr:s=>Buffer.from(s).toString('base64url'),unb64urlStr:s=>Buffer.from(s,'base64url').toString(),
  playerName:x=>x,entitlementOf:()=>null,mcpRoute:()=>({rest:[]}),loadUsers:async()=>Object.fromEntries([...rows].filter(([k])=>k.startsWith('/users/')).map(([k,v])=>[k.slice(7),v]))});
 vm.runInContext("const fbUrl=(env,path)=>`${DB}${path}.json?auth=${env.FB_SECRET}`;\n"+['fbGet','fbPut','hmac','timingSafeEqual','makeSession','readSession','bozoConfig','sessionAuth','mcpPassOf','mcpAuth'].map(extract).join('\n')+'\nconst mcpTokenHash=(env,token)=>hmac(env.BOZO_PEPPER,"mcp|"+token);',context);
 const token='u_synthetic-agent-token',digest=await context.hmac(env.BOZO_PEPPER,'mcp|'+token);put('/users/u_agent',{name:'Agent',mcpToken:digest});
 const session=await context.makeSession(env,'Owner',0,'u_owner');
 const dependencies={fbGet:context.fbGet,fbPut:context.fbPut,sessionAuth:context.sessionAuth,mcpAuth:context.mcpAuth,transition,view,codeHash:hash('test-source')};
 let handler=createResearchGateway(dependencies);
 const request=async(route='state',body,identity='user',tenant='demo',extra={})=>handler(new Request(`https://worker.invalid/research/v1/tenants/${tenant}/${route}`,{method:body?'POST':'GET',headers:{...(identity==='user'?{'X-Dawg-Session':session}:identity==='agent'?{Authorization:`Bearer ${token}`}:{Authorization:identity}),'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}),env);
 let count=0;const command=(type,payload,identity='user',key=String(++count))=>request('command',{type,key,payload},identity);
 return {env,rows,put,request,command,dependencies,reset:()=>handler=createResearchGateway(dependencies),writes:()=>writes,onPut:fn=>onPut=fn,session,context};
}

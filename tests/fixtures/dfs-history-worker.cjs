const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function(){
 const source=fs.readFileSync(path.join(__dirname,'../../dawg-bot-worker.js'),'utf8').replace(/^import .*;$/m,'const BOZO_ESPN_TEAM_SEED={};').replace('export default','const worker=');
 const context=vm.createContext({console,Date,URL,Response,Request,Headers,TextEncoder,TextDecoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout});
 vm.runInContext(source+`\nglobalThis.api={run:dfsRun,tools:MCP_TOOLS,route:handleDfsWorkspace};
 fbGet=async(e,p)=>{const children=Object.fromEntries(Object.entries(e.rows).filter(([k])=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(([k,v])=>[k.slice(p.length+1),v]));return {data:e.rows[p]|| (Object.keys(children).length?children:null),etag:String(e.versions[p]||0)};};
 fbPut=async(e,p,v,t)=>{if(e.failIndex&&p.includes('/dfsHistory/index/')){e.failIndex=false;throw Error('synthetic index interruption');}if(t!=null&&String(e.versions[p]||0)!==t)return false;e.rows[p]=JSON.parse(JSON.stringify(v));e.versions[p]=(e.versions[p]||0)+1;return true;};
 sessionAuth=async(r)=>r.headers.get('X-Bozo-Session')==='synthetic-A'?{uid:'userA'}:r.headers.get('X-Bozo-Session')==='synthetic-B'?{uid:'userB'}:{err:'unauthorized',code:401};`,context);
 return {api:context.api,env:{rows:{},versions:{}}};
};

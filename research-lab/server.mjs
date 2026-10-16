import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync,appendFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {initialState,transition,view,hash,capabilities} from './machine.mjs';
import {syntheticTracking} from './tracking.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createLab({directory=path.join(os.tmpdir(),'datadawgs-research-lab'),port=0}={}) {
  mkdirSync(directory,{recursive:true});
  const lock=path.join(directory,'writer.lock'); const fd=openSync(lock,'wx');
  const journal=path.join(directory,'journal.jsonl');
  let state=initialState();
  const codeHash=hash(['machine.mjs','machine-core.mjs','tracking.mjs','server.mjs'].map(f=>readFileSync(path.join(root,f),'utf8')).join('\n'));
  const principal={tenant:'local-research',id:'local-owner',capabilities};
  try {
    if(existsSync(journal)) {
      let previous=null;
      for(const line of readFileSync(journal,'utf8').trim().split('\n').filter(Boolean)) {
        const entry=JSON.parse(line),{checksum,...body}=entry;
        if(hash(body)!==checksum||body.previous!==previous) throw new Error('Journal integrity check failed');
        state=body.state;previous=checksum;
      }
    }
  } catch(e) {closeSync(fd);unlinkSync(lock);throw e;}
  let tail=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8').trim().split('\n').at(-1)).checksum:null;
  const execute=command=>{
    const next=transition(state,principal,command,Date.now(),codeHash);
    if(command.type==='run') {
      const artifact=path.join(directory,`${next.result.hashes.data}.input.json`);
      if(!existsSync(artifact))writeFileSync(artifact,JSON.stringify({tracking:command.payload.tracking}),{flag:'wx',flush:true});
    }
    const body={previous:tail,state:next.state};const checksum=hash(body);
    appendFileSync(journal,JSON.stringify({...body,checksum})+'\n',{encoding:'utf8',flush:true});
    state=next.state;tail=checksum;return next.result;
  };
  if(!state.hypotheses.length) {
    for(const [i,title,method] of [
      [1,'Speed kept through a change of direction','Candidate only. Audit speed reliability, define the turn window, and compare against an appropriate baseline before inference.'],
      [2,'Motion and body heading alignment','Measure angular alignment of dir and o. This does not measure hip–shoulder decoupling.'],
      [3,'Missingness before model complexity','Audit missing fields and sampling intervals by entity and cohort before designing a study.']]) {
      const h=execute({type:'hypothesis',key:`seed-h-${i}`,payload:{title,method}});
      execute({type:'task',key:`seed-t-${i}`,payload:{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000}});
    }
  }
  const assets=new Map([['/navigation.css','navigation.css'],['/navigation.js','navigation.js'],['/','index.html'],['/app.mjs','app.mjs'],['/client.mjs','client.mjs'],['/style.css','style.css'],['/instrument.css','instrument.css'],['/tracking.mjs','tracking.mjs'],['/CONTRACT.md','CONTRACT.md'],['/brand.png','../assets/data-dawgs-site-logo-560.png'],['/assets/data-dawgs-site-logo-560.png','../assets/data-dawgs-site-logo-560.png']]);
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(value):value);};
    if(req.headers.host!==new URL(origin).host) return send(403,{error:'Host denied'});
    if(req.headers.origin&&req.headers.origin!==origin) return send(403,{error:'Origin denied'});
    if(req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'Cross-site request denied'});
    const url=new URL(req.url,origin);
    try {
      if(req.method==='GET'&&url.pathname==='/client-config.mjs')return send(200,"export default {mode:'local'};",'text/javascript');
      if(req.method==='GET'&&url.pathname==='/api/state') return send(200,{...view(state,principal),adapters:{externalAI:'unconfigured',scheduler:'unconfigured',verifiedData:'unconfigured',holdout:'disabled'},mode:'single-user loopback',codeHash});
      if(req.method==='GET'&&url.pathname==='/api/tracking') return send(200,syntheticTracking());
      if(req.method==='POST'&&url.pathname==='/api/command') {
        if(req.headers.origin!==origin||req.headers['content-type']!=='application/json') return send(403,{error:'Same-origin JSON required'});
        const chunks=[];let bytes=0;for await(const part of req) {bytes+=part.length;if(bytes>2_000_000) return send(413,{error:'Request too large'});chunks.push(part);}
        const command=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // Only these operations are available to the local dashboard. No principal from the request.
        if(!['hypothesis','evidence','discussion','task','claim','run'].includes(command.type)) throw new Error('Unknown command');
        return send(200,execute(command));
      }
      if(req.method==='GET'&&assets.has(url.pathname)) {
        const file=assets.get(url.pathname);return send(200,readFileSync(path.join(root,file)),file.endsWith('.png')?'image/png':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.md')?'text/plain':'text/html');
      }
      send(404,{error:'Not found'});
    }catch(e){send(400,{error:e.message});}
  });
  server.on('close',()=>{closeSync(fd);unlinkSync(lock);});
  server.listen(port,'127.0.0.1');
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createLab({port:Number(process.env.LAB_PORT||8788),directory:process.env.LAB_STATE_DIR});
  server.on('listening',()=>console.log(`Research lab: http://127.0.0.1:${server.address().port} — synthetic discovery only`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}

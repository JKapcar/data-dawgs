// Produces an isolated release candidate. Never edits the production Worker,
// manifest, assembler, security rules or environment, and never deploys anything.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
export function buildWorker(destination=path.join(root,'../work/artifacts/research-lab')) {
  const modules=['tracking.mjs','machine-core.mjs','worker-core.mjs','gateway.mjs'];
  const worker=readFileSync(path.join(root,'../dawg-bot-worker.js'),'utf8');
  const anchor='  async fetch(request, env) {';
  if(worker.split(anchor).length!==2)throw new Error('Worker entry changed; review integration before rebuilding');
  const sources=['../dawg-bot-worker.js','../bozo-team-registry.mjs','build-worker.mjs',...modules];
  const manifest=Object.fromEntries(sources.map(f=>[f,createHash('sha256').update(readFileSync(path.join(root,f))).digest('hex')]));
  const codeHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  mkdirSync(destination,{recursive:true});
  const integration=`import {createResearchGateway} from './gateway.mjs';\nimport {transition,view} from './worker-core.mjs';\nconst ddResearchGateway=createResearchGateway({fbGet,fbPut,sessionAuth,mcpAuth,transition,view,codeHash:'${codeHash}'});\n`;
  writeFileSync(path.join(destination,'worker.mjs'),integration+worker.replace(anchor,anchor+"\n    if(new URL(request.url).pathname.startsWith('/research/'))return ddResearchGateway(request,env);"));
  for(const f of modules)copyFileSync(path.join(root,f),path.join(destination,f));
  copyFileSync(path.join(root,'../bozo-team-registry.mjs'),path.join(destination,'bozo-team-registry.mjs'));
  writeFileSync(path.join(destination,'build-manifest.json'),JSON.stringify({codeHash,sources:manifest,enabled:false},null,2));
  const ui=path.join(destination,'dashboard');mkdirSync(ui,{recursive:true});
  for(const f of ['index.html','app.mjs','client.mjs','client-config.mjs','browser-runner.mjs','browser-engine.mjs','worker-core.mjs','machine-core.mjs','style.css','instrument.css','tracking.mjs','CONTRACT.md'])copyFileSync(path.join(root,f),path.join(ui,f));
  // Relative asset works at the root or a separately approved /research-lab/ path.
  writeFileSync(path.join(ui,'index.html'),readFileSync(path.join(ui,'index.html'),'utf8').replace('src="../assets/data-dawgs-site-logo-560.png"','src="brand.png"'));
  copyFileSync(path.join(root,'../assets/data-dawgs-site-logo-560.png'),path.join(ui,'brand.png'));
  return {destination,codeHash,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildWorker(process.argv[2]),null,2));

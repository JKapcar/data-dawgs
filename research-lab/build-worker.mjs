// Produces an isolated release candidate. Never edits the production Worker,
// manifest, assembler, security rules or environment, and never deploys anything.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
export function buildWorker(destination=path.join(root,'../work/artifacts/research-lab')) {
  const modules=['tracking.mjs','machine-core.mjs','worker-core.mjs','gateway.mjs','upload-gateway.mjs','exact-store.mjs','agent-identity.mjs','pound-agent-gateway.mjs','agent-setup.mjs','owner-apps.mjs','development-data.mjs','development-index.mjs','development-v3.mjs'];
  const worker=readFileSync(path.join(root,'../dawg-bot-worker.js'),'utf8');
  const anchor='  async fetch(request, env) {';
  if(worker.split(anchor).length!==2)throw new Error('Worker entry changed; review integration before rebuilding');
  const sources=['repair-owner-envelope.mjs','../dawg-bot-worker.js','../bozo-team-registry.mjs','build-worker.mjs',...modules];
  const manifest=Object.fromEntries(sources.map(f=>[f,createHash('sha256').update(readFileSync(path.join(root,f))).digest('hex')]));
  const codeHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  mkdirSync(destination,{recursive:true});
  const integration=`import {createResearchGateway} from './gateway.mjs';\nimport {exactStore} from './exact-store.mjs';\nimport {transition,view} from './worker-core.mjs';\nconst ddResearchGateway=createResearchGateway({...exactStore(fbGet,fbPut),sessionAuth,mcpAuth,transition,view,codeHash:'${codeHash}'});\n`;
  const agentIntegration="import {createPoundAgentGateway} from './pound-agent-gateway.mjs';\nimport {createAgentSetup} from './agent-setup.mjs';\nconst ddPoundAgentGateway=createPoundAgentGateway({fbGet,fbPut});\nconst ddAgentSetup=createAgentSetup({fbGet,fbPut,ownerIdentity:poundIdentity});\n";
  const ownerIntegration="import {createOwnerApps} from './owner-apps.mjs';\nconst ddOwnerApps=createOwnerApps({fbGet,fbPut,ownerIdentity:poundIdentity,transition,view,codeHash:'"+codeHash+"',pound:{empty:poundEmpty,view:poundView,write:poundWrite,validate:poundValidate,schema:POUND_SCHEMA,hash:poundHash,canonical:poundCanonical},project:{enabled:projectEnabled,load:projectLoad,apply:projectApply,read:projectRead,commit:projectCommit,schema:PROJECT_SCHEMA,sections:PROJECT_SECTIONS,limits:PROJECT_LIMITS}});\n";
  const uploadIntegration="import {createUploadGateway} from './upload-gateway.mjs';\nconst ddUploadGateway=createUploadGateway({fbGet,fbPut,sessionAuth});\n";
  writeFileSync(path.join(destination,'worker.mjs'),integration+uploadIntegration+agentIntegration+worker.replace(anchor,anchor+"\n    if(new URL(request.url).pathname.startsWith('/owner-apps/'))return ddOwnerApps.permissions(request,env);\n    if(new URL(request.url).pathname.startsWith('/agent-setup/'))return ddAgentSetup(request,env);\n    if(new URL(request.url).pathname.startsWith('/agents/'))return ddPoundAgentGateway(request,env);\n    if(new URL(request.url).pathname.startsWith('/research-upload/'))return ddUploadGateway(request,env);\n    if(new URL(request.url).pathname.startsWith('/research/'))return ddResearchGateway(request,env);")+"\n"+ownerIntegration);
  for(const f of modules)copyFileSync(path.join(root,f),path.join(destination,f));
  copyFileSync(path.join(root,'../bozo-team-registry.mjs'),path.join(destination,'bozo-team-registry.mjs'));
  writeFileSync(path.join(destination,'build-manifest.json'),JSON.stringify({codeHash,sources:manifest,enabled:false},null,2));
  const ui=path.join(destination,'dashboard');mkdirSync(ui,{recursive:true});
  for(const f of ['index.html','private.html','decisions.html','decisions.css','decisions.mjs','decision-controls.mjs','app.mjs','client.mjs','client-config.mjs','browser-runner.mjs','browser-engine.mjs','worker-core.mjs','machine-core.mjs','style.css','instrument.css','tracking.mjs','CONTRACT.md','upload.html','upload.mjs','upload.css','agent-setup.html','agent-setup-ui.mjs','agent-setup.css','navigation.css','navigation.js','account.js','app-permissions.html','app-permissions.mjs','OWNER-CONNECTOR.md'])copyFileSync(path.join(root,f),path.join(ui,f));
  for(const file of ['install-help.js','install-help.css'])copyFileSync(path.join(root,'../',file),path.join(destination,file));
  // Relative asset works at the root or a separately approved /research-lab/ path.
  writeFileSync(path.join(ui,'index.html'),readFileSync(path.join(ui,'index.html'),'utf8').replace('src="../assets/data-dawgs-site-logo-560.png"','src="brand.png"'));
  copyFileSync(path.join(root,'../assets/data-dawgs-site-logo-560.png'),path.join(ui,'brand.png'));
  return {destination,codeHash,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildWorker(process.argv[2]),null,2));

// Public demonstration: actual deterministic analysis, isolated to this tab's memory.
// No account token, storage grant, provider, persistence or shared-service request.
import {initialState,transition,view,capabilities,codeHash} from './browser-engine.mjs';
export async function createBrowserRunner() {
  const principal={tenant:'browser-sandbox',id:'browser-demo',capabilities};let state=initialState(),tail=Promise.resolve();
  const command=(type,payload,key)=>{const run=tail.then(async()=>{const next=await transition(state,principal,{type,payload,key},Date.now(),codeHash);state=next.state;return next.result;});tail=run.catch(()=>{});return run;};
  for(const [i,title,method] of [
    [1,'Speed kept through a change of direction','Candidate only. Audit speed reliability, define the turn window, and compare against an appropriate baseline before inference.'],
    [2,'Motion and body heading alignment','Measure angular alignment of dir and o. This does not measure hip-shoulder decoupling.'],
    [3,'Missingness before model complexity','Audit missing fields and sampling intervals by entity and cohort before designing a study.']]){
    const h=await command('hypothesis',{title,method},`seed-h-${i}`);await command('task',{hypothesisId:h.id,split:'discovery',budgetMs:5000,maxObservations:10000},`seed-t-${i}`);
  }
  return {command,state:()=>({...view(state,principal),identity:{actor:principal.id,tenant:principal.tenant,kind:'demo'},mode:'browser-memory-demo',codeHash,adapters:{externalAI:'unconfigured',scheduler:'unconfigured',verifiedData:'unconfigured',holdout:'disabled'}})};
}

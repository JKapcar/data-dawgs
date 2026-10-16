import {syntheticTracking} from './tracking.mjs';
const SITE_ORIGINS=['https://datadawgs216.com','https://www.datadawgs216.com'];
const WORKER_ORIGIN='https://toto.jkapcar4.workers.dev';
export function createClient(config,{fetcher=fetch,origin=location.origin,token=()=>{try{return localStorage.getItem('dd-bozo-sess')||'';}catch{return '';}},onInvalidated=()=>{},onVerified=()=>{},onRejected=()=>{}}={}) {
  const hosted=config.mode==='hosted';
  if(hosted&&(!SITE_ORIGINS.includes(origin)||config.workerOrigin!==WORKER_ORIGIN||!/^[A-Za-z0-9_-]{1,100}$/.test(config.tenant)))throw new Error('Hosted research configuration denied');
  if(config.mode==='local'&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Local runner requires loopback');
  let identity=null,epoch=0;
  let demo;
  const invalidate=()=>{identity=null;epoch++;onInvalidated();};
  async function request(route,body) {
    if(config.mode==='browser'){
      if(route==='tracking')return syntheticTracking();
      demo??=import('./browser-runner.mjs').then(m=>m.createBrowserRunner());const runner=await demo;
      return route==='state'?runner.state():runner.command(body.type,body.payload,body.key);
    }
    if(!['local','hosted'].includes(config.mode))throw new Error('Shared research is unconfigured. No hosted connection has been enabled.');
    if(route==='tracking')return syntheticTracking();
    const credential=hosted?token():'';
    if(hosted&&!credential){invalidate();throw new Error('Sign in through the existing DataDawgs sign-in page. Research access also requires an explicit grant.');}
    if(identity!==credential){if(identity!==null)invalidate();identity=credential;epoch++;}const generation=epoch;
    const url=hosted?`${WORKER_ORIGIN}/research/v1/tenants/${config.tenant}/${route}`:`/api/${route}`;
    const r=await fetcher(url,{method:body?'POST':'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{...(hosted?{Authorization:'Bearer '+credential}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const ensureIdentity=()=>{if(generation!==epoch||(hosted&&credential!==token())){invalidate();throw new Error('Identity changed; reload research state.');}};
    ensureIdentity();
    const data=await r.json();
    ensureIdentity();
    if(!r.ok){if(r.status===401||r.status===403)invalidate();if(hosted)onRejected(r.status);throw new Error(data.error||'Research request failed');}
    if(hosted)onVerified(credential);
    return data;
  }
  return {mode:config.mode,invalidate,state:()=>request('state'),tracking:()=>request('tracking'),command:(type,payload,key=crypto.randomUUID())=>request('command',{type,payload,key})};
}

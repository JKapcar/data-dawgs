/* Read-only JSON state subscription. A stream update invalidates older HTTP reads;
 * failures preserve the last good value. No commands, credentials or persistence. */
(function(root){
  'use strict';
  function create(options){
    const fetcher = options.fetch || fetch;
    const Stream = options.EventSource === undefined ? globalThis.EventSource : options.EventSource;
    const clock = options.now || Date.now;
    const every = options.setInterval || setInterval;
    const cancel = options.clearInterval || clearInterval;
    const delay = options.setTimeout || setTimeout;
    const clearDelay = options.clearTimeout || clearTimeout;
    const events = options.events || globalThis;
    const navigatorRef = options.navigator || globalThis.navigator;
    const pollMs = options.pollMs || 15000, staleMs = options.staleMs || 45000;
    let active=false, generation=0, revision=0, inFlight=null, queued=false, stream=null, timer=null;
    let lastSuccessAt=null, state='loading', reason=null, controller=null;
    const snapshot = ()=>({state, reason, lastSuccessAt});
    function status(next, why=null){
      state=next; reason=why; options.onStatus?.(snapshot());
    }
    function valid(value){
      if(value !== null && (typeof value !== 'object' || Array.isArray(value) ||
          Object.prototype.hasOwnProperty.call(value, 'error'))) throw new Error('invalid_response');
      return value || {};
    }
    function accept(value){
      revision++;
      lastSuccessAt=clock();
      status('fresh');
      // Consumer rendering errors are not network failures and must remain visible.
      options.onData(value);
    }
    async function refresh(){
      if(!active) return;
      if(inFlight) return inFlight;
      const startGeneration=generation, startRevision=revision;
      controller=new AbortController();
      const requestController=controller;
      const deadline=delay(()=>requestController.abort(), options.requestTimeoutMs || 10000);
      inFlight=(async()=>{
        let value;
        try{
          const response=await fetcher(options.url, {cache:'no-store', signal:requestController.signal});
          if(!response.ok) throw new Error('http_'+response.status);
          value=valid(await response.json());
        }catch(error){
          if(active && generation===startGeneration && revision===startRevision)
            status(navigatorRef?.onLine===false ? 'offline' : lastSuccessAt===null ? 'error' : 'stale',
              /^http_\d+$/.test(error.message) ? error.message : 'unavailable');
          return;
        }
        if(active && generation===startGeneration && revision===startRevision) accept(value);
      })();
      try { await inFlight; }
      finally {
        clearDelay(deadline);
        // A stopped subscription may already have been replaced with a new one.
        if(generation===startGeneration){
          inFlight=null; controller=null;
          if(queued && active){ queued=false; void refresh(); }
        }
      }
    }
    function refreshAfterChange(){
      revision++;
      if(inFlight) queued=true;
      else void refresh();
    }
    function online(){ if(active) void refresh(); }
    function offline(){ if(active) status('offline', 'network_offline'); }
    function start(){
      if(active) return;
      active=true; generation++;
      status(navigatorRef?.onLine===false ? 'offline' : 'loading');
      const currentGeneration=generation;
      if(Stream){
        try{
          stream=new Stream(options.url);
          stream.addEventListener('put', event=>{
            if(!active || generation!==currentGeneration) return;
            let message, value;
            try{
              message=JSON.parse(event.data);
              if(message.path==='/') value=valid(message.data);
            }catch{ refreshAfterChange(); return; }
            if(message.path!=='/'){ refreshAfterChange(); return; }
            accept(value);
          });
          stream.addEventListener('patch', ()=>{
            if(active && generation===currentGeneration) refreshAfterChange();
          });
          stream.onerror=()=>{
            if(active && generation===currentGeneration){
              if(lastSuccessAt===null || clock()-lastSuccessAt>=staleMs)
                status(navigatorRef?.onLine===false ? 'offline' : 'stale', 'stream_unavailable');
              void refresh();
            }
          };
        }catch{ stream=null; }
      }
      events.addEventListener?.('online', online);
      events.addEventListener?.('offline', offline);
      timer=every(()=>{
        if(lastSuccessAt!==null && clock()-lastSuccessAt>=staleMs)
          status(navigatorRef?.onLine===false ? 'offline' : 'stale', 'refresh_due');
        void refresh();
      }, pollMs);
      void refresh();
    }
    function stop(){
      active=false; generation++; queued=false;
      controller?.abort(); controller=null; inFlight=null;
      stream?.close(); stream=null;
      if(timer!==null) cancel(timer); timer=null;
      events.removeEventListener?.('online', online);
      events.removeEventListener?.('offline', offline);
    }
    return {start, stop, refresh, snapshot};
  }
  root.DDLiveState={create};
})(typeof module !== 'undefined' && module.exports ? module.exports : globalThis);

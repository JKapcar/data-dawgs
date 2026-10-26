/* Manager-only estimate form. Existing page helpers own authentication. */
(function(root){
  const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).filter(k=>v[k]!=null).sort().map(k=>[k,v[k]])):v);
  const implied=x=>x<0?-x/(100-x):100/(100+x);
  const valid=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)>=100&&Math.abs(x)<=100000;
  function editableInput(input){return !input?.method||input.method==='owner_push_zero_v1';}
  function preserveDecimals(old,input){
    const d=old?.closeQuote?.originalDecimal;if(!d)return input;
    const q=input.closeQuote,o=old.closeQuote;
    if(!q||q.book!==o.book||q.price!==o.price||q.opposite!==o.opposite)throw Error('Original decimal evidence is attached. Review through the supported evidence workflow before changing its book or prices.');
    q.originalDecimal=structuredClone(d);return input;
  }
  function preview(row,input){
    if(!editableInput(input))throw Error('This modeled estimate is read-only in this form; use the reviewed evidence workflow.');
    if(input.method==='owner_push_zero_v1'){
      if(row.result!=='push'||typeof input.rationale!=='string'||!input.rationale.trim()||input.rationale.length>400)throw Error('Push-zero convention requires a recorded push and a rationale.');
      return {point:0,low:0,high:0,holds:[],kind:'convention'};
    }
    const q=input.closeQuote,pair=(a,b)=>valid(a)&&valid(b)?{fair:implied(a)/(implied(a)+implied(b)),hold:implied(a)+implied(b)-1}:null;
    if(!valid(row.price)||!valid(q.price)||(q.opposite!==null&&!valid(q.opposite)))throw Error('Enter valid American prices; leave an unknown opposite blank.');
    if(!row.selectionKey||!row.entryBook||q.selectionKey!==row.selectionKey||!/^[-a-z0-9_]{2,40}$/.test(q.book||''))throw Error('Exact selection identity and explicit source book required.');
    if(q.book!==row.entryBook&&!valid(q.opposite))throw Error('Cross-book quotes require both observed sides.');
    if(q.originalDecimal){const d=q.originalDecimal,american=x=>x>=2?(x-1)*100:-100/(x-1);if(!['price','opposite'].every(k=>typeof d[k]==='number'&&Number.isFinite(d[k])&&d[k]>1&&d[k]<=1001&&valid(q[k])&&Math.abs(american(d[k])-q[k])<1e-7))throw Error('Original decimal evidence must match unrounded American inputs.');}
    const url=new URL(q.sourceUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a public HTTPS source URL without credentials, query or fragment.');
    if(!input.rationale.trim()||input.rationale.length>400)throw Error('Explain the evidence and assumptions (maximum 400 characters).');
    if(!Number.isFinite(Date.parse(q.retrievedAt))||(q.quotedAt!==null&&!Number.isFinite(Date.parse(q.quotedAt))))throw Error('Use ISO timestamps; an unknown quote time stays blank.');
    if(!['source_reported_closing','observed_pregame','untimed_quote_proxy'].includes(q.evidence))throw Error('Choose a supported evidence classification.');
    if(q.evidence==='untimed_quote_proxy'&&q.quotedAt!==null)throw Error('Untimed quote proxy must leave quote time unknown.');
    if(q.evidence==='observed_pregame'&&(!Number.isFinite(Date.parse(row.startsAt))||q.quotedAt===null||Date.parse(q.quotedAt)>=Date.parse(row.startsAt)))throw Error('Observed pregame evidence needs a quote time before known kickoff.');
    const entry=row.entryOppSource==='assumed'?null:pair(row.price,row.priceOpp),close=pair(q.price,q.opposite),cal=close||entry;
    let holds;
    if(cal){if(cal.hold<0||cal.hold>.3)throw Error('Observed overround is outside the supported range.');holds=entry&&close?[cal.hold]:[Math.max(0,cal.hold-.02),cal.hold,Math.min(.3,cal.hold+.02)];}
    else {holds=input.scenarios;if(!Array.isArray(holds)||holds.length!==3||holds.some(x=>!Number.isFinite(x)||x<0||x>.3)||!(holds[0]<holds[1]&&holds[1]<holds[2]))throw Error('With two one-sided quotes, choose three increasing overround percentages from 0 to 30.');}
    const values=holds.map(h=>100*((close?close.fair:implied(q.price)/(1+h))-(entry?entry.fair:implied(row.price)/(1+h))));
    return {point:values[Math.floor(values.length/2)],low:Math.min(...values),high:Math.max(...values),holds};
  }
  function mount(host,api){
    if(!host)return;
    if(!api.isManager()){host.replaceChildren();delete host.dataset.context;return;}
    const context=api.league()+'|'+api.identity();
    if(host.dataset.context===context)return;
    host.dataset.context=context;
    host.innerHTML=`<details class="method" data-ddb-skip><summary>Manager: save estimated CLV</summary>
      <p>Supplemental estimates only. Original prices, manual overrides, results and week status stay unchanged.</p>
      <button type="button" class="btn ghost" data-load>Load league ledger</button>
      <style>.cem-form{display:grid;gap:12px;max-width:680px;min-width:0;overflow-wrap:anywhere}.cem-form[hidden]{display:none}.cem-form label{min-width:0}.cem-form input,.cem-form select,.cem-form textarea{max-width:100%;box-sizing:border-box}</style><form class="cem-form" hidden>
      <label>Ledger leg <select name="row" style="width:100%;max-width:100%"></select></label><p data-basis></p>
      <label>Method <select name="method"><option value="quote">Sourced quote estimate</option><option value="owner_push_zero_v1">Owner push-zero convention</option></select></label>
      <label>Source book (lowercase identifier) <input name="book" value="draftkings" required pattern="[-a-z0-9_]{2,40}"></label>
      <label>Closing price (American) <input name="price" type="number" step="any" required></label>
      <label>Opposite closing price (blank if unknown) <input name="opposite" type="number" step="any"></label>
      <label>Public source URL <input name="sourceUrl" type="url" required style="width:100%;box-sizing:border-box"></label>
      <label>Evidence <select name="evidence"><option value="source_reported_closing">Source-reported closing quote</option><option value="observed_pregame">Observed pregame quote</option><option value="untimed_quote_proxy">Untimed quote used as closing proxy</option></select></label>
      <label>Quote timestamp (ISO; blank if unknown) <input name="quotedAt" placeholder="2026-10-22T20:00:00-04:00"></label>
      <label>Retrieval timestamp (ISO) <input name="retrievedAt" required></label>
      <label>Source limitations and assumptions <textarea name="rationale" required maxlength="400" rows="3" style="width:100%;box-sizing:border-box"></textarea></label>
      <label>Overround scenarios (%) only if neither quote has a pair <input name="scenarios" placeholder="Three increasing percentages, comma-separated"></label>
      <button class="btn ghost" type="submit">Preview estimate</button><output data-preview aria-live="polite"></output>
      <button class="btn" type="button" data-save disabled>Save estimated CLV</button></form>
      <p data-status role="status" aria-live="polite"></p></details>`;
    const form=host.querySelector('form'),field=n=>form.elements.namedItem(n),status=host.querySelector('[data-status]'),save=host.querySelector('[data-save]'),output=host.querySelector('[data-preview]');
    let rows={},row=null,pending=null,busy=false,readOnly=false;
    const quoteFields=['book','price','opposite','sourceUrl','evidence','quotedAt','retrievedAt','scenarios'];
    function methodState(){const convention=field('method').value==='owner_push_zero_v1';for(const n of quoteFields){field(n).disabled=convention||readOnly;field(n).required=!convention&&['book','price','sourceUrl','retrievedAt'].includes(n);}field('method').disabled=readOnly;field('rationale').disabled=readOnly;form.querySelector('[type=submit]').disabled=readOnly;}
    const active=()=>api.isManager()&&context===api.league()+'|'+api.identity()&&host.dataset.context===context;
    const ensure=()=>{if(!active())throw Error('Account or league changed. Reload the ledger before saving.');};
    function select(){if(busy)return;row=rows[field('row').value];pending=null;save.disabled=true;output.textContent='';if(!row)return;
      host.querySelector('[data-basis]').textContent=`Entry ${row.price??'unknown'} / ${row.priceOpp??'unknown'}; ledger result ${row.result??'pending (server checks current result)'}; estimate revision ${row.clvEstimate?.revision||0}. Manual override ${row.clvPts??'none'} stays authoritative.`;
      const old=row.clvEstimate?.input;readOnly=!editableInput(old);field('method').value=old?.method==='owner_push_zero_v1'?'owner_push_zero_v1':'quote';field('book').value=old?.closeQuote?.book||row.entryBook||'';field('price').value=old?.closeQuote?.price??row.close??'';field('opposite').value=old?.closeQuote?.opposite??row.closeOpp??'';
      for(const n of ['sourceUrl','quotedAt'])field(n).value=old?.closeQuote?.[n]??'';
      field('retrievedAt').value=old?.closeQuote?.retrievedAt||'';field('evidence').value=old?.closeQuote?.evidence||'source_reported_closing';field('rationale').value=old?.rationale||'';field('scenarios').value=old?.scenarios?.map(x=>x*100).join(', ')||'';methodState();if(readOnly)output.textContent='This modeled estimate is read-only in this form; its evidence and method will not be converted.';
    }
    host.querySelector('[data-load]').onclick=async()=>{if(busy)return;busy=true;status.textContent='Loading ledger…';try{ensure();const data=await api.read('ledger');ensure();rows=data.value||{};field('row').replaceChildren();
      for(const [key,r] of Object.entries(rows).sort((a,b)=>(a[1].week-b[1].week))){const opt=document.createElement('option');opt.value=key;opt.textContent=`Week ${r.week} · ${api.who(r.player)} · ${r.label||r.selectionKey||key}`;field('row').append(opt);}
      form.hidden=!Object.keys(rows).length;busy=false;select();status.textContent=form.hidden?'No ledger rows.':'Ledger loaded. Select a leg and review its source evidence.';
    }catch(e){status.textContent=e.message;}finally{busy=false;}};
    field('row').onchange=select;
    form.oninput=event=>{if(busy)return;if(event.target===field('method'))methodState();if(event.target===field('sourceUrl'))field('retrievedAt').value='';save.disabled=true;output.textContent='Preview the changed evidence before saving.';};
    form.onsubmit=event=>{event.preventDefault();try{ensure();if(!row)throw Error('Load a ledger row first.');if(readOnly)throw Error('This modeled estimate is read-only in this form.');const numeric=n=>field(n).value.trim()===''?null:Number(field(n).value);
      const estimate=field('method').value==='owner_push_zero_v1'?{method:'owner_push_zero_v1',rationale:field('rationale').value.trim()}:{closeQuote:{price:numeric('price'),opposite:numeric('opposite'),book:field('book').value.trim(),selectionKey:row.selectionKey,sourceUrl:field('sourceUrl').value.trim(),quotedAt:field('quotedAt').value.trim()||null,retrievedAt:field('retrievedAt').value.trim(),evidence:field('evidence').value},rationale:field('rationale').value.trim()};
      if(!estimate.method&&field('scenarios').value.trim())estimate.scenarios=field('scenarios').value.split(',').map(x=>Number(x.trim())/100);
      if(!estimate.method)preserveDecimals(row.clvEstimate?.input,estimate);const calc=preview(row,estimate),signature=JSON.stringify({row:field('row').value,estimate});
      if(!pending||pending.signature!==signature)pending={signature,body:{league:api.league(),row:field('row').value,requestId:crypto.randomUUID(),expectedEstimateRevision:row.clvEstimate?.revision||0,estimate}};
      output.textContent=estimate.method==='owner_push_zero_v1'?'Owner push convention: 0 pp. Not measured or estimated CLV. Recorded outcome remains unchanged.':(estimate.closeQuote.evidence==='untimed_quote_proxy'?'Untimed quote used as closing proxy. Not a verified closing price. ':'')+`Estimated ${calc.point.toFixed(2)} pp; sensitivity ${calc.low.toFixed(2)} to ${calc.high.toFixed(2)} pp. Overround ${calc.holds.map(x=>(100*x).toFixed(2)+'%').join(' / ')}. Not a confidence interval or expected ROI. Price preview only; server checks settlement and evidence precedence.`;save.disabled=false;status.textContent='Review the preview, then save.';
    }catch(e){save.disabled=true;status.textContent=e.message;}};
    save.onclick=async()=>{if(busy||!pending||readOnly)return;busy=true;let verified=false;const snapshot=structuredClone(row),protectedFields=x=>{const {clvEstimate,...rest}=x;return stable(rest);};Array.from(form.elements).forEach(e=>e.disabled=true);host.querySelector('[data-load]').disabled=true;status.textContent='Saving; awaiting persisted readback…';try{ensure();const body=pending.body;const result=await api.write('/bozo/close',body);ensure();const read=await api.read('ledger/'+body.row);ensure();const stored=read.value?.clvEstimate;if(field('row').value!==body.row||protectedFields(read.value||{})!==protectedFields(snapshot))throw Error('Ledger or selection changed during save. Reload and review before using the estimate.');
      if(!result.ok||!stored||stored.requestId!==body.requestId||stored.revision!==result.estimate?.revision||stable(stored.input)!==stable(body.estimate)||stable(stored)!==stable(result.estimate)||!Number.isFinite(stored.point))throw Error('Save not verified. Reload or retry identical evidence; do not assume success.');
      row=read.value;rows[body.row]=row;verified=true;status.textContent=`Saved and verified revision ${stored.revision}: ${stored.kind==='convention'?'owner convention':'estimated'} ${stored.point.toFixed(2)} pp.`;await api.refresh();
    }catch(e){status.textContent=e.message;}finally{busy=false;Array.from(form.elements).forEach(e=>e.disabled=false);host.querySelector('[data-load]').disabled=false;methodState();save.disabled=verified||readOnly;}};
  }
  root.DDClvEstimateManager={mount,preview,editableInput,preserveDecimals};
  if(typeof module!=='undefined')module.exports={preview,editableInput,preserveDecimals};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>root.mountBozoEstimateManager?.());
})(typeof window!=='undefined'?window:globalThis);

/* Manager-only estimate form. Existing page helpers own authentication. */
(function(root){
  const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).filter(k=>v[k]!=null).sort().map(k=>[k,v[k]])):v);
  const implied=x=>x<0?-x/(100-x):100/(100+x);
  const valid=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)>=100;
  function preview(row,input){
    const q=input.closeQuote,pair=(a,b)=>valid(a)&&valid(b)?{fair:implied(a)/(implied(a)+implied(b)),hold:implied(a)+implied(b)-1}:null;
    if(!valid(row.price)||!valid(q.price)||(q.opposite!==null&&!valid(q.opposite)))throw Error('Enter valid American prices; leave an unknown opposite blank.');
    if(!row.selectionKey||row.entryBook!=='draftkings')throw Error('This row lacks a supported DraftKings selection identity.');
    const url=new URL(q.sourceUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a public HTTPS source URL without credentials, query or fragment.');
    if(!input.rationale.trim()||input.rationale.length>400)throw Error('Explain the evidence and assumptions (maximum 400 characters).');
    if(!Number.isFinite(Date.parse(q.retrievedAt))||(q.quotedAt!==null&&!Number.isFinite(Date.parse(q.quotedAt))))throw Error('Use ISO timestamps; an unknown quote time stays blank.');
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
    host.innerHTML=`<details class="method" open data-ddb-skip><summary>Manager: save estimated CLV</summary>
      <p>Supplemental estimates only. Original prices, manual overrides, results and week status stay unchanged.</p>
      <button type="button" class="btn ghost" data-load>Load league ledger</button>
      <style>.cem-form{display:grid;gap:12px;max-width:680px;min-width:0;overflow-wrap:anywhere}.cem-form[hidden]{display:none}.cem-form label{min-width:0}.cem-form input,.cem-form select,.cem-form textarea{max-width:100%;box-sizing:border-box}</style><form class="cem-form" hidden>
      <label>Ledger leg <select name="row" style="width:100%;max-width:100%"></select></label><p data-basis></p>
      <label>Book <input value="DraftKings" readonly></label>
      <label>Closing price (American) <input name="price" type="number" required></label>
      <label>Opposite closing price (blank if unknown) <input name="opposite" type="number"></label>
      <label>Public source URL <input name="sourceUrl" type="url" required style="width:100%;box-sizing:border-box"></label>
      <label>Evidence <select name="evidence"><option value="source_reported_closing">Source-reported closing quote</option><option value="observed_pregame">Observed pregame quote</option></select></label>
      <label>Quote timestamp (ISO; blank if unknown) <input name="quotedAt" placeholder="2026-10-22T20:00:00-04:00"></label>
      <label>Retrieval timestamp (ISO) <input name="retrievedAt" required></label>
      <label>Source limitations and assumptions <textarea name="rationale" required maxlength="400" rows="3" style="width:100%;box-sizing:border-box"></textarea></label>
      <label>Overround scenarios (%) only if neither quote has a pair <input name="scenarios" placeholder="Three increasing percentages, comma-separated"></label>
      <button class="btn ghost" type="submit">Preview estimate</button><output data-preview aria-live="polite"></output>
      <button class="btn" type="button" data-save disabled>Save estimated CLV</button></form>
      <p data-status role="status" aria-live="polite"></p></details>`;
    const form=host.querySelector('form'),field=n=>form.elements.namedItem(n),status=host.querySelector('[data-status]'),save=host.querySelector('[data-save]'),output=host.querySelector('[data-preview]');
    let rows={},row=null,pending=null,busy=false;
    const active=()=>api.isManager()&&context===api.league()+'|'+api.identity()&&host.dataset.context===context;
    const ensure=()=>{if(!active())throw Error('Account or league changed. Reload the ledger before saving.');};
    function select(){if(busy)return;row=rows[field('row').value];pending=null;save.disabled=true;output.textContent='';if(!row)return;
      host.querySelector('[data-basis]').textContent=`Entry ${row.price??'unknown'} / ${row.priceOpp??'unknown'}; ledger result ${row.result??'pending (server checks current result)'}; estimate revision ${row.clvEstimate?.revision||0}. Manual override ${row.clvPts??'none'} stays authoritative.`;
      const old=row.clvEstimate?.input;field('price').value=old?.closeQuote.price??row.close??'';field('opposite').value=old?.closeQuote.opposite??row.closeOpp??'';
      for(const n of ['sourceUrl','quotedAt'])field(n).value=old?.closeQuote[n]??'';
      field('retrievedAt').value=old?.closeQuote.retrievedAt||'';field('evidence').value=old?.closeQuote.evidence||'source_reported_closing';field('rationale').value=old?.rationale||'';field('scenarios').value=old?.scenarios?.map(x=>x*100).join(', ')||'';
    }
    host.querySelector('[data-load]').onclick=async()=>{if(busy)return;busy=true;status.textContent='Loading ledger…';try{ensure();const data=await api.read('ledger');ensure();rows=data.value||{};field('row').replaceChildren();
      for(const [key,r] of Object.entries(rows).sort((a,b)=>(a[1].week-b[1].week))){const opt=document.createElement('option');opt.value=key;opt.textContent=`Week ${r.week} · ${api.who(r.player)} · ${r.label||r.selectionKey||key}`;field('row').append(opt);}
      form.hidden=!Object.keys(rows).length;busy=false;select();status.textContent=form.hidden?'No ledger rows.':'Ledger loaded. Select a leg and review its source evidence.';
    }catch(e){status.textContent=e.message;}finally{busy=false;}};
    field('row').onchange=select;
    form.oninput=event=>{if(busy)return;if(event.target===field('sourceUrl'))field('retrievedAt').value='';save.disabled=true;output.textContent='Preview the changed evidence before saving.';};
    form.onsubmit=event=>{event.preventDefault();try{ensure();if(!row)throw Error('Load a ledger row first.');const numeric=n=>field(n).value.trim()===''?null:Number(field(n).value);
      const estimate={closeQuote:{price:numeric('price'),opposite:numeric('opposite'),book:'draftkings',selectionKey:row.selectionKey,sourceUrl:field('sourceUrl').value.trim(),quotedAt:field('quotedAt').value.trim()||null,retrievedAt:field('retrievedAt').value.trim(),evidence:field('evidence').value},rationale:field('rationale').value.trim()};
      if(field('scenarios').value.trim())estimate.scenarios=field('scenarios').value.split(',').map(x=>Number(x.trim())/100);
      const calc=preview(row,estimate),signature=JSON.stringify({row:field('row').value,estimate});
      if(!pending||pending.signature!==signature)pending={signature,body:{league:api.league(),row:field('row').value,requestId:crypto.randomUUID(),expectedEstimateRevision:row.clvEstimate?.revision||0,estimate}};
      output.textContent=`Estimated ${calc.point.toFixed(2)} pp; sensitivity ${calc.low.toFixed(2)} to ${calc.high.toFixed(2)} pp. Overround ${calc.holds.map(x=>(100*x).toFixed(2)+'%').join(' / ')}. Not a confidence interval or expected ROI. Price preview only; server checks settlement and evidence precedence.`;save.disabled=false;status.textContent='Review the preview, then save.';
    }catch(e){save.disabled=true;status.textContent=e.message;}};
    save.onclick=async()=>{if(busy||!pending)return;busy=true;let verified=false;const snapshot=structuredClone(row),protectedFields=x=>{const {clvEstimate,...rest}=x;return stable(rest);};Array.from(form.elements).forEach(e=>e.disabled=true);host.querySelector('[data-load]').disabled=true;status.textContent='Saving; awaiting persisted readback…';try{ensure();const body=pending.body;const result=await api.write('/bozo/close',body);ensure();const read=await api.read('ledger/'+body.row);ensure();const stored=read.value?.clvEstimate;if(field('row').value!==body.row||protectedFields(read.value||{})!==protectedFields(snapshot))throw Error('Ledger or selection changed during save. Reload and review before using the estimate.');
      if(!result.ok||!stored||stored.requestId!==body.requestId||stored.revision!==result.estimate?.revision||stable(stored.input)!==stable(body.estimate)||stable(stored)!==stable(result.estimate)||!Number.isFinite(stored.point))throw Error('Save not verified. Reload or retry identical evidence; do not assume success.');
      row=read.value;rows[body.row]=row;verified=true;status.textContent=`Saved and verified revision ${stored.revision}: estimated ${stored.point.toFixed(2)} pp.`;await api.refresh();
    }catch(e){status.textContent=e.message;}finally{busy=false;Array.from(form.elements).forEach(e=>e.disabled=false);host.querySelector('[data-load]').disabled=false;save.disabled=verified;}};
  }
  root.DDClvEstimateManager={mount,preview};
  if(typeof module!=='undefined')module.exports={preview};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>root.mountBozoEstimateManager?.());
})(typeof window!=='undefined'?window:globalThis);

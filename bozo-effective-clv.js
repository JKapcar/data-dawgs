/* Presentation-only CLV resolver. Never writes settlement or capture fields. */
(function(root){
 const valid=x=>typeof x==='number'&&Number.isFinite(x),odds=x=>valid(x)&&Math.abs(x)>=100;
 const imp=x=>x<0?-x/(100-x):100/(100+x);
 const pair=(a,b)=>odds(a)&&odds(b)?imp(a)/(imp(a)+imp(b)):null;
 function resolve(l){
  const e=l.clvEstimate,base=pair(l.entryPrice,l.entryPriceOpp),override=l.clvPts!=null&&Number.isFinite(+l.clvPts);
  if(override)return finish(+l.clvPts,'override',base,l,'Manager override');
  if(l.verificationStatus!=='unverified'&&l.clvEligible!==false&&l.entryOppSource!=='assumed'&&l.closeOppSource!=='assumed'){
   const close=pair(l.closePrice,l.closePriceOpp);if(base!==null&&close!==null)return finish(100*(close-base),'measured',base,l,'Captured paired prices');
  }
  if(e?.kind==='estimated'&&!e.stale&&valid(e.point)){
   let pe=l.entryOppSource==='assumed'?null:base;
   if(pe===null&&odds(e.entryPrice)){const h=e.scenarios?.[Math.floor(e.scenarios.length/2)];if(valid(h)&&h>=0&&h<=.3)pe=imp(e.entryPrice)/(1+h);}
   return finish(e.point,'estimated',pe,l,e.closeQuote?.evidence==='untimed_quote_proxy'?'Untimed quote used as closing proxy':e.closeQuote?.evidence||'Estimated quote',e.closeQuote?.sourceUrl);
  }
  return {point:null,kind:'unknown',pE:null,pC:null,clv:null,reason:e?.stale?'Stale estimate; review required':!l.result?'Pending outcome / missing usable CLV':'No usable CLV evidence',source:null};
 }
 function finish(point,kind,pE,l,reason,source=null){const pc=pE===null?null:pE+point/100;return {point,kind,pE,pC:valid(pc)&&pc>=0&&pc<=1?pc:null,clv:point/100,manual:kind==='override',estimated:kind==='estimated',reason,source};}
 function outcome(l){return l.result==='won'?'win':l.result==='lost'?'loss':['win','loss','push','void'].includes(l.result)?l.result:null;}
 function rows(legs){return legs.map((l,index)=>{const e=resolve(l),r=outcome(l),y=(r==='win'||r==='loss')&&e.pC!==null?100*((r==='win'?1:0)-e.pC):null;return {leg:l,index,...e,result:r,x:e.point,y,charted:e.point!==null&&y!==null};});}
 function counts(items){return {total:items.length,charted:items.filter(x=>x.charted).length,measured:items.filter(x=>x.kind==='measured').length,estimated:items.filter(x=>x.kind==='estimated').length,override:items.filter(x=>x.kind==='override').length,unknown:items.filter(x=>x.point===null).length,pending:items.filter(x=>!x.result).length,push:items.filter(x=>x.result==='push').length,void:items.filter(x=>x.result==='void').length};}
 root.DDEffectiveClv={resolve,rows,counts};if(typeof module!=='undefined')module.exports=root.DDEffectiveClv;
})(typeof window!=='undefined'?window:globalThis);

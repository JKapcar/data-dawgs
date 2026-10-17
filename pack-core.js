/* Pure public evidence helpers. No transport, account access or agent execution. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.PackCore=api;})(globalThis,function(){
  'use strict';
  function evidenceState(e,today=new Date().toISOString().slice(0,10)){
    if(e.status==='version-changed')return 'version-changed';
    if(e.status==='unknown'||!e.checkedAt)return 'unknown';
    if(e.status==='stale'||(Date.parse(today)-Date.parse(e.checkedAt))/86400000>90)return 'stale';
    return e.status;
  }
  function taskFit(profile,required){
    const missing=required.filter(k=>profile.capabilities[k]!=='verified');
    return {status:missing.length?'blocked':'candidate',missing};
  }
  function pairMetrics(rows){
    const valid=rows.filter(r=>r.excludedReason===null&&typeof r.aPassed==='boolean'&&typeof r.bPassed==='boolean');
    const failures=valid.filter(r=>!r.aPassed),both=valid.filter(r=>!r.aPassed&&!r.bPassed);
    const sameEligible=both.filter(r=>typeof r.sameWrongAnswer==='boolean');
    return {valid:valid.length,excluded:rows.length-valid.length,coFailure:valid.length?both.length/valid.length:null,
      rescueDenominator:failures.length,rescue:failures.length?failures.filter(r=>r.bPassed).length/failures.length:null,
      sameWrongDenominator:sameEligible.length,sameWrong:sameEligible.length?sameEligible.filter(r=>r.sameWrongAnswer).length/sameEligible.length:null};
  }
  function reviewMetrics(rows){
    const valid=rows.filter(r=>r.excludedReason===null&&typeof r.beforePassed==='boolean'&&typeof r.afterPassed==='boolean');
    const corrected=valid.filter(r=>!r.beforePassed&&r.afterPassed).length;
    const introduced=valid.filter(r=>r.beforePassed&&!r.afterPassed).length;
    return {valid:valid.length,excluded:rows.length-valid.length,corrected,introduced,netGain:valid.length?(corrected-introduced)/valid.length:null};
  }
  return {evidenceState,taskFit,pairMetrics,reviewMetrics};
});

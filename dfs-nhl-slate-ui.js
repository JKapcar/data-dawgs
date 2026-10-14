(function(){
  'use strict';
  const data=window.DDNHLReviewedSlate, root=document.getElementById('reviewedSlate');
  if(!data||!root)return;
  const $=id=>document.getElementById(id), fmt=n=>n==null?'Unknown':Number(n).toFixed(2);
  function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);}
  function render(){
    const mode=$('slateRankMode').value, query=$('slateRankSearch').value.trim().toLowerCase();
    const rows=data.players.filter(p=>(mode==='goalies'?p.position==='G':p.position!=='G')&&(mode!=='value'||p.valueRank!=null)&&(!query||(p.name+' '+p.team).toLowerCase().includes(query))).sort((a,b)=>(mode==='value'?a.valueRank-b.valueRank:a.rank-b.rank));
    $('slateScoreLabel').textContent=mode==='value'?'Indicative pts / $1K':'DK if '+(mode==='goalies'?'starting':'active');
    $('slateRankRows').replaceChildren();
    for(const p of rows.slice(0,$('slateShowAll').checked?rows.length:10)){
      const tr=document.createElement('tr');cell(tr,mode==='value'?p.valueRank:p.rank);cell(tr,p.name+' · '+p.team+' '+p.position);cell(tr,fmt(mode==='value'?p.value:p.points));cell(tr,p.flag||[p.line,p.pp].filter(Boolean).join(' / ')+' · role unverified');$('slateRankRows').append(tr);
    }
    $('slateRankCount').textContent=`${Math.min(rows.length,$('slateShowAll').checked?rows.length:10)} of ${rows.length} shown. ${mode==='value'?'Value uses October 13 placeholder prices; it is not current-slate value.':mode==='goalies'?'Conditional on starting; reported status is dated, not a live feed.':'Conditional on being active; availability is unresolved.'}`;
  }
  $('slateReviewStamp').textContent='Reviewed '+data.reviewedAt+' · Published '+data.publishedAt;
  for(const p of data.scenarios){const li=document.createElement('li');li.textContent=`${p.name}: ${p.status}. ${fmt(p.points)} DK if active. Scenario changes: ${p.changes}. ${p.check}`;$('slateScenarios').append(li);}
  for(const id of ['slateRankMode','slateShowAll'])$(id).addEventListener('change',render);
  $('slateRankSearch').addEventListener('input',render);render();
})();

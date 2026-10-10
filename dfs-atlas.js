/* Read-only lineup atlas. All preview values are synthetic inputs, never simulation results. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let read, rows=[],selected=0,axis='own',preview=true;
 const money=n=>'$'+Math.round(n).toLocaleString('en-US');
 function sample(){
  const names=['Ellis','Reed','Hayes','Banks','Cole','Moss','Lane','Stone','Wells','Brooks','Ford','West','Gray','Quinn','North','South'];
  const positions=['QB','QB','RB','RB','RB','RB','WR','WR','WR','WR','WR','WR','TE','TE','DST','DST'];
  const salaries=[6900,6200,7200,6300,5400,4800,7600,6800,5900,5100,4600,4100,4900,3800,3100,2600];
  const projections=[23.1,20.8,21.4,18.3,16.6,12.2,22.8,19.5,17.1,13.7,11.9,10.4,13.2,9.8,7.9,6.6];
  const ownership=[24,12,29,20,8,14,31,17,25,9,6,13,18,7,12,5];
  const players=names.map((name,i)=>({name:'Demo '+name,pos:positions[i],team:(i<8?['NTH','STH']:['EST','WST'])[i%2],gid:i<8?'NTH@STH':'EST@WST',sal:salaries[i],proj:projections[i],own:ownership[i]}));
  const lineups=[];
  for(let q=0;q<2;q++)for(let r=2;r<5;r++)for(let w=6;w<9;w++)for(let t=12;t<14;t++){
   const ids=[q,r,r+1,w,w+1,w+2,t,11,14+(lineups.length%2)];
   if(new Set(ids).size!==9)continue;
   const sal=ids.reduce((s,i)=>s+players[i].sal,0);if(sal>50000)continue;
   lineups.push({ids,proj:ids.reduce((s,i)=>s+players[i].proj,0)});
  }
  return {players,lineups,synthetic:true,source:'Invented Classic sample'};
 }
 function model(data){
  return data.lineups.slice(0,600).map((l,i)=>{
   const roster=l.ids.map(id=>{const p=data.players[id];if(!p)return null;const cpt=l.cpt===id,weight=cpt?1.5:1;return {...p,slot:cpt?'CPT':p.pos,points:cpt&&Number.isFinite(p.cptProj)?p.cptProj:Number.isFinite(p.proj)?p.proj*weight:null,salary:cpt?(p.cptSal||Math.round(p.sal*1.5)):p.sal};});
   if(roster.some(p=>!p||p.points==null||!Number.isFinite(p.salary)))return null;
   return {i,roster,proj:roster.reduce((s,p)=>s+p.points,0),sal:roster.reduce((s,p)=>s+p.salary,0),own:roster.every(p=>Number.isFinite(p.own))?roster.reduce((s,p)=>s+p.own,0):null};
  }).filter(Boolean);
 }
 function refresh(){
  if(!read||!$('atlasPlot'))return;
  const live=read();preview=!live.lineups.length;const data=preview?sample():live;rows=model(data);
  if(!rows.some(r=>r.i===selected))selected=rows[0]?.i||0;
  $('atlasSource').textContent=preview?'SYNTHETIC • INTERACTIVE SAMPLE':data.synthetic?'SYNTHETIC • GENERATED LINEUPS':'YOUR WORKSPACE • INPUT PROJECTIONS';
  $('atlasCount').textContent=rows.length.toString().padStart(2,'0');
  $('atlasCaption').textContent=preview?'Invented players. Roster-valid examples, not solver-ranked. Tap a point to inspect its lineup.':`Showing ${rows.length} of ${live.lineups.length} lineups. ${data.synthetic?'Invented demo inputs. ':''}Projection and ownership are inputs, not observed results.`;
  $('atlasOwn').disabled=rows.some(r=>r.own===null);
  if($('atlasOwn').disabled){axis='sal';$('atlasCaption').textContent+=' Ownership is incomplete; showing salary instead.';}
  if(live.loading)$('atlasCaption').textContent+=' Demo calculation running; the chart updates when generated lineups are available.';
  $('atlasMethodNote').textContent=preview?'This sample is calculated from invented player projections, salaries and ownership. No simulation has run for these examples.':'The chart recalculates projected points from current player inputs. It does not claim that saved lineups were generated under current constraints. Only the first 600 lineups are displayed.';
  draw();
 }
 function draw(){
  const visible=rows, mobile=$('atlasPlot').clientWidth<500, W=mobile?360:800,H=mobile?330:390,left=mobile?41:64,right=mobile?16:30,top=35,bottom=59;
  $('atlasOwn').setAttribute('aria-pressed',axis==='own');$('atlasSalary').setAttribute('aria-pressed',axis==='sal');
  for(const id of ['atlasPrev','atlasNext','atlasSelect'])$(id).disabled=!visible.length;
  if(!visible.length){$('atlasPlot').innerHTML='<p class="atlas-empty">Complete player projections and salaries to plot these lineups.</p>';$('atlasRoster').replaceChildren();$('atlasSelect').replaceChildren();for(const id of ['atlasProjection','atlasCost','atlasOwnership'])$(id).textContent='—';$('atlasLineup').textContent='No valid lineup';return;}
  const xs=visible.map(r=>r[axis]),ys=visible.map(r=>r.proj),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const dx=Math.max(axis==='sal'?1000:12,maxX-minX),dy=Math.max(8,maxY-minY);
  const xlo=minX-dx*.12,xhi=maxX+dx*.12,ylo=minY-dy*.15,yhi=maxY+dy*.2;
  const X=x=>left+(x-xlo)/(xhi-xlo)*(W-left-right),Y=y=>H-bottom-(y-ylo)/(yhi-ylo)*(H-top-bottom);
  const frontier=visible.filter(a=>!visible.some(b=>b[axis]<=a[axis]&&b.proj>=a.proj&&(b[axis]<a[axis]||b.proj>a.proj))).sort((a,b)=>a[axis]-b[axis]);
  let grid='';for(let k=0;k<=4;k++){let y=ylo+(yhi-ylo)*k/4,x=xlo+(xhi-xlo)*k/4;grid+=`<line x1="${left}" x2="${W-right}" y1="${Y(y)}" y2="${Y(y)}"/><text x="${left-12}" y="${Y(y)+4}" text-anchor="end">${y.toFixed(0)}</text><line x1="${X(x)}" x2="${X(x)}" y1="${top}" y2="${H-bottom}"/><text x="${X(x)}" y="${H-bottom+25}" text-anchor="middle">${axis==='sal'?'$'+(x/1000).toFixed(1)+'k':x.toFixed(0)+' pp'}</text>`;}
  const chosen=visible.find(r=>r.i===selected)||visible[0];selected=chosen.i;
  const path=frontier.map((r,i)=>(i?'L':'M')+X(r[axis])+','+Y(r.proj)).join(' ');
  $('atlasPlot').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="atlasSvgTitle atlasSvgDesc"><title id="atlasSvgTitle">Lineup projection versus ${axis==='own'?'summed ownership':'salary'}</title><desc id="atlasSvgDesc">${visible.length} lineups. Higher is more projected points; left is lower ${axis==='own'?'summed ownership':'salary'}. Use the lineup selector below for keyboard access and exact values.</desc><defs><linearGradient id="atlasGlow" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ff751f" stop-opacity=".18"/><stop offset="1" stop-color="#ff751f" stop-opacity="0"/></linearGradient></defs><g class="atlas-grid">${grid}</g><text class="atlas-axis" x="${left}" y="16">PROJECTED POINTS ↑</text><text class="atlas-axis" x="${W-right}" y="${H-8}" text-anchor="end">${axis==='own'?'SUMMED OWNERSHIP (pp)':'SALARY USED ($)'} →</text><path class="atlas-front-fill" d="${path} L${X(frontier.at(-1)[axis])},${H-bottom} L${X(frontier[0][axis])},${H-bottom} Z"/><path class="atlas-front" d="${path}"/><line class="atlas-cross" x1="${left}" x2="${W-right}" y1="${Y(chosen.proj)}" y2="${Y(chosen.proj)}"/><line class="atlas-cross" x1="${X(chosen[axis])}" x2="${X(chosen[axis])}" y1="${top}" y2="${H-bottom}"/>${visible.map(r=>`<g data-atlas-point="${r.i}" class="atlas-point ${r.i===selected?'selected':''}"><title>Lineup ${r.i+1}: ${r.proj.toFixed(1)} projected points, ${axis==='sal'?money(r.sal):r.own.toFixed(0)+' percentage points summed ownership'}</title><circle class="atlas-hit" cx="${X(r[axis])}" cy="${Y(r.proj)}" r="22"/><circle class="atlas-dot" cx="${X(r[axis])}" cy="${Y(r.proj)}" r="${r.i===selected?8:5}"/>${r.i===selected?`<circle class="atlas-ring" cx="${X(r[axis])}" cy="${Y(r.proj)}" r="16"/>`:''}</g>`).join('')}</svg>`;
  $('atlasSelect').innerHTML=visible.map(r=>`<option value="${r.i}" ${r.i===selected?'selected':''}>Lineup ${String(r.i+1).padStart(2,'0')} · ${r.proj.toFixed(1)} pts · ${money(r.sal)}</option>`).join('');
  $('atlasPlot').querySelectorAll('[data-atlas-point]').forEach(el=>el.addEventListener('click',()=>choose(+el.dataset.atlasPoint)));
  $('atlasLineup').textContent='Lineup '+String(selected+1).padStart(2,'0');
  $('atlasProjection').textContent=chosen.proj.toFixed(1);$('atlasCost').textContent=money(chosen.sal);$('atlasOwnership').textContent=chosen.own==null?'Unavailable':chosen.own.toFixed(0)+' pp';
  const max=Math.max(...chosen.roster.map(p=>p.points),1);
  $('atlasRoster').innerHTML=chosen.roster.map(p=>`<li><span class="atlas-pos">${esc(p.slot)}</span><span class="atlas-player"><span title="${esc(p.name)}">${esc(p.name)}</span><i style="--contribution:${Math.max(0,p.points/max)*100}%"></i></span><b>${p.points.toFixed(1)}</b></li>`).join('');
  $('atlasSelectionStatus').textContent=`Lineup ${selected+1}. ${chosen.proj.toFixed(1)} projected points. ${money(chosen.sal)} salary.`;
 }
 function choose(i){selected=i;draw();}
 function connect(reader){read=reader;
  $('atlasOwn').onclick=()=>{axis='own';draw();};$('atlasSalary').onclick=()=>{axis='sal';draw();};
  $('atlasSelect').onchange=e=>choose(+e.target.value);
  $('atlasPrev').onclick=()=>{const i=rows.findIndex(r=>r.i===selected);choose(rows[(i+rows.length-1)%rows.length]?.i||0);};
  $('atlasNext').onclick=()=>{const i=rows.findIndex(r=>r.i===selected);choose(rows[(i+1)%rows.length]?.i||0);};
  refresh();
  let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(draw,100);});
 }
 window.DDFSAtlas={connect,refresh};
})();

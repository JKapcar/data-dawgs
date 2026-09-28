/* Transparent sensitivity arithmetic and descriptive historical comparisons. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DDFourthAnalysis=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const available=(r,id)=>r.choices.find(c=>c.id===id)?.wp!=null;
  function threshold(success,failure,alternative){
    const slope=success-failure;
    if(Math.abs(slope)<1e-12)return {p:null,direction:0,always:failure>alternative?'above':failure<alternative?'below':'tie'};
    return {p:(alternative-failure)/slope,direction:Math.sign(slope)};
  }
  function scenario(r,p=r.conversion,q=r.fgMake){
    for(const value of [p,q])if(!Number.isFinite(value)||value<0||value>1)throw Error('Probability must be from 0 to 1.');
    const goWP=p*r.successWP+(1-p)*r.failWP,fgWP=q*r.makeWP+(1-q)*r.missWP;
    const choices=r.choices.map(c=>({...c,wp:c.wp===null?null:c.id==='go'?goWP:c.id==='fg'?fgWP:c.wp}));
    const ranked=choices.filter(c=>c.wp!==null).sort((a,b)=>b.wp-a.wp),edge=100*(ranked[0].wp-ranked[1].wp);
    return {...r,conversion:p,fgMake:q,goWP,fgWP,choices,best:ranked[0].id,edge,strength:edge>5?'Very strong':edge>2.5?'Strong':edge>1?'Medium':'Close call'};
  }
  function comparisons(r,kind){
    const success=kind==='go'?r.successWP:r.makeWP,failure=kind==='go'?r.failWP:r.missWP;
    return r.choices.filter(c=>c.id!==kind&&c.wp!==null).map(c=>({...c,...threshold(success,failure,c.wp)}));
  }
  function median(values){const a=[...values].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length?(a.length%2?a[i]:(a[i-1]+a[i])/2):null;}
  function percentile(values,p){
    const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
    if(!a.length||!Number.isFinite(p))return null;
    const below=a.filter(v=>v<p-1e-12).length,atOrBelow=a.filter(v=>v<=p+1e-12).length;
    return {below,atOrBelow,n:a.length,percentile:100*atOrBelow/a.length,min:a[0],max:a.at(-1),belowSample:p<a[0],aboveSample:p>a.at(-1)};
  }
  function historical(env,input,kind){
    if(!env?.data?.seasons)return null;
    const team=Number(input.home)?input.homeTeam:input.awayTeam;
    const zone=input.yardline<=20?'red':input.yardline<=50?'opp':'own';
    const band=Math.floor((Number(input.yardline)+18)/10)*10;
    const bucket=kind==='go'?`${Math.min(11,input.toGo)}|${zone}`:`${band}|${input.roof==='outdoors'?'out':'in'}`;
    const counts={},seasonRows=[],current=env.data.current_season;
    const seasons=Object.keys(env.data.seasons).sort();
    for(const season of seasons)for(const [t,[s,n]] of Object.entries(env.data.seasons[season][kind]?.[bucket]||{})){
      const row=counts[t]??={team:t,s:0,n:0,currentS:0,currentN:0};row.s+=s;row.n+=n;
      seasonRows.push({team:t,season:+season,s,n,raw:s/n});
      if(+season===current){row.currentS=s;row.currentN=n;}
    }
    const values=Object.values(counts),s=values.reduce((a,r)=>a+r.s,0),n=values.reduce((a,r)=>a+r.n,0);
    if(!n)return null;
    const prior=env.data.prior_attempts;
    for(const r of values){
      // Exclude the selected team's observations from its league prior.
      const baseline=n>r.n?(s-r.s)/(n-r.n):s/n;
      r.raw=r.s/r.n;r.estimate=(r.s+prior*baseline)/(r.n+prior);
      // Wilson interval for observed rate, not an interval for the matchup model.
      const z=1.95996398454,den=1+z*z/r.n,mid=(r.raw+z*z/(2*r.n))/den;
      const half=z*Math.sqrt(r.raw*(1-r.raw)/r.n+z*z/(4*r.n*r.n))/den;
      r.low=Math.max(0,mid-half);r.high=Math.min(1,mid+half);
    }
    return {team,selected:counts[team]||null,rows:values.sort((a,b)=>a.estimate-b.estimate),seasonRows,median:median(values.map(r=>r.estimate)),pooled:s/n,s,n,prior,seasons,current,
      through:env.data.seasons[String(current)].through,asOf:env.as_of,
      cohort:kind==='go'?`4th & ${input.toGo>=11?'11+':input.toGo} · ${zone==='red'?'opponent 1–20':zone==='opp'?'opponent 21–50':'own territory'}`:`${band}–${band+9}-yard field goals · ${input.roof==='outdoors'?'open-air':'closed-roof'}`};
  }
  // Brill/Yurko/Wyner fitted go_model_b1: at fourth-and-1 the distance basis is zero.
  // Source commit 2f4df27a1df102ad55b9983aa1e5b9daeb85ee74, retrieved 2026-09-28.
  function publishedConversion(toGo,z){
    if(Number(toGo)!==1)return null;
    if(!Number.isFinite(z)||z < -2||z > 2)throw Error('Published comparison strength must be between -2 and +2 SD.');
    return 1/(1+Math.exp(-(0.6961039190652341+0.13230533049039203*z)));
  }
  return {available,threshold,scenario,comparisons,historical,median,percentile,publishedConversion};
});

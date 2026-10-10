/* Goal Lens: score the same fourth-down outcomes against a different objective.
 *
 * The nfl4th port answers one question: which choice has the highest win probability
 * (WP)? This module re-scores the identical outcome lots under other goals a fan or a
 * coach might really hold. It never changes a lot's probability or its WP.
 *
 * Everything path-shaped reduces to one function,
 *     share(p, x, T, H) = expected share of the next H seconds with WP above x,
 *                         starting from WP p with T seconds left,
 * because the time-average of any u(WP) is u(0) + the integral of u'(x) * share(x).
 * So a new goal is a few lines in GOALS, not a new model.
 *
 * share() comes from a probit diffusion on a measured information clock V(t), fitted
 * and tested in tools/fourth-down-paths.py and published at data/fourth-down-paths.json.
 * It is a martingale: it cannot move expected WP. It is modelled, not observed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DDFourthGoals=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Standard normal CDF (West 2005, double precision) and quantile (Acklam + one Halley step).
  function cdf(x){
    const a=Math.abs(x);let c;
    if(a>37)c=0;
    else{
      const e=Math.exp(-a*a/2);
      if(a<7.07106781186547){
        let n=3.52624965998911e-2*a+0.700383064443688;n=n*a+6.37396220353165;n=n*a+33.912866078383;n=n*a+112.079291497871;n=n*a+221.213596169931;n=n*a+220.206867912376;
        let d=8.83883476483184e-2*a+1.75566716318264;d=d*a+16.064177579207;d=d*a+86.7807322029461;d=d*a+296.564248779674;d=d*a+637.333633378831;d=d*a+793.826512519948;d=d*a+440.413735824752;
        c=e*n/d;
      }else c=e/(a+1/(a+2/(a+3/(a+4/(a+0.65)))))/2.506628274631;
    }
    return x>0?1-c:c;
  }
  function quantile(p){
    if(!(p>0&&p<1))return p<=0?-Infinity:Infinity;
    const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
    let x;
    if(p<0.02425){const q=Math.sqrt(-2*Math.log(p));x=(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    else if(p>1-0.02425){const q=Math.sqrt(-2*Math.log(1-p));x=-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    else{const q=p-.5,r=q*q;x=(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
    const e=cdf(x)-p,u=e*Math.sqrt(2*Math.PI)*Math.exp(x*x/2);
    return x-u/(1+x*u/2);
  }
  // 12-point Gauss-Legendre on [0,1].
  const GL=(()=>{const x=[0.1252334085114689,0.3678314989981802,0.5873179542866175,0.7699026741943047,0.9041172563704749,0.9815606342467192],w=[0.2491470458134028,0.2334925365383548,0.2031674267230659,0.1600783285433462,0.1069393259953184,0.0471753363865118],n=[];for(let i=0;i<6;i++){n.push([(1-x[i])/2,w[i]/2],[(1+x[i])/2,w[i]/2]);}return n;})();

  function createClock(env){
    const d=env?.data,k=d?.knots_seconds,v=d?.information_remaining;
    if(!env?.as_of||!env?.source||!Array.isArray(k)||!Array.isArray(v)||k.length!==v.length||k.length<3||k[0]!==0||v[0]!==0||Math.abs(v.at(-1)-1)>1e-9)throw Error('Path model is incomplete.');
    for(let i=1;i<k.length;i++)if(!(k[i]>k[i-1])||!(v[i]>v[i-1]))throw Error('Path model clock must increase.');
    const max=k.at(-1);
    function V(t){
      if(t<=0)return 0;if(t>=max)return 1;
      let i=1;while(k[i]<t)i++;
      return v[i-1]+(v[i]-v[i-1])*(t-k[i-1])/(k[i]-k[i-1]);
    }
    return {V,knots:k,max,abstainBelow:d.abstain_below_seconds??0,error:d.test?.rmse_outside_abstain_window??null,asOf:env.as_of,fit:d.fit?.seasons,test:d.test?.seasons};
  }
  /* Expected share of the next H seconds with WP above x, from WP p with T seconds left. */
  function share(clock,p,x,T,H=T){
    if(!(x>0))return 1;if(!(x<1))return 0;
    if(!(T>0))return p>x?1:0;
    T=Math.min(T,clock.max);H=Math.min(H,T);
    if(!(H>0)||p<=0||p>=1)return p>x?1:0;
    const z=quantile(p),zx=quantile(x),vt=clock.V(T),lo=T-H;
    const f=tau=>{const r=clock.V(tau)/vt;return r>=1?(z>zx?1:z<zx?0:.5):cdf((z-zx*Math.sqrt(r))/Math.sqrt(1-r));};
    const cuts=[lo,...clock.knots.filter(k=>k>lo&&k<T),T];
    let total=0;
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i],last=i===cuts.length-1;
      // The final piece ends at "now", where the integrand turns a square-root corner:
      // tau = b - (b-a)u^2 puts the nodes where the curve is.
      for(const [u,w] of GL)total+=last?w*2*u*(b-a)*f(b-(b-a)*u*u):w*(b-a)*f(a+(b-a)*u);
    }
    return total/H;
  }
  function pathFor(clock,lot,horizon){
    const H=horizon==null?lot.t:Math.min(horizon,lot.t),memo=new Map();
    const at=x=>{if(!memo.has(x))memo.set(x,share(clock,lot.wp,x,lot.t,H));return memo.get(x);};
    return {seconds:H,share:at,
      // Expected time-average of max(0, ref - WP): how far below a reference you sit.
      shortfall(ref){let s=0;for(const [u,w] of GL)s+=w*ref*(1-at(ref*u));return s;}};
  }
  /* The registry. `weigh` says how lots combine: 'time' = seconds of the horizon
     (occupancy goals), 'outcome' = plain probability (WP-unit goals). */
  const GOALS={
    win:{label:'Win the game',short:'Win probability',unit:'wp',path:false,params:[],
      blurb:'The standard bot. Highest chance of winning, nothing else counts.',
      score:lot=>lot.wp,describe:()=>'win probability'},
    avg:{label:'Average win probability',short:'Average WP, rest of game',unit:'wp',path:false,identity:true,params:[],
      blurb:'Average your win probability over every remaining second. Provably the same number as Win the game.',
      score:lot=>lot.wp,describe:()=>'average win probability'},
    above:{label:'Time above a line',short:'Time above the line',unit:'share',path:true,weigh:'time',
      params:[{id:'x',label:'Win-probability line',min:5,max:95,step:1,value:50,suffix:'%'}],
      presets:[['Still alive',{x:20}],['Ahead',{x:50}],['Comfortable',{x:80}]],
      blurb:'Spend as much of the clock as possible with win probability above your line.',
      score:(lot,P,path)=>path.share(P.x/100),range:P=>`above ${P.x}%`,describe:P=>`time above ${P.x}%`},
    band:{label:'Keep it a game',short:'Time it stays close',unit:'share',path:true,weigh:'time',
      params:[{id:'w',label:'How close counts as close',min:5,max:45,step:1,value:30,suffix:' pts either side of 50%'}],
      blurb:'The neutral fan’s goal: as much clock as possible with neither team out of it.',
      score:(lot,P,path)=>Math.max(0,path.share(.5-P.w/100)-path.share(.5+P.w/100)),range:P=>`between ${50-P.w}% and ${50+P.w}%`,describe:P=>`time between ${50-P.w}% and ${50+P.w}%`},
    loss:{label:'Hate falling behind',short:'Loss-averse win probability',unit:'felt',path:true,weigh:'outcome',needsRef:true,horizon:0,
      params:[{id:'k',label:'Pain multiplier',min:1,max:4,step:.25,value:2,suffix:'×'}],
      blurb:'Win probability, but every point spent below where you stand now hurts more than a point above it helps.',
      score:(lot,P,path,ref)=>lot.wp-ref-(P.k-1)*path.shortfall(ref),describe:P=>`win probability with drops counted ${P.k}×`}
  };
  function params(goal,given={}){
    const out={};for(const p of GOALS[goal].params){const v=Number(given[p.id]);out[p.id]=Number.isFinite(v)?Math.min(p.max,Math.max(p.min,v)):p.value;}
    return out;
  }
  /* Lots for a result, reweighted when the reader has moved the conversion or FG slider. */
  function lotsFor(base,scenario){
    const s=scenario||base,out={};
    for(const id of ['go','fg','punt']){
      const lots=base.lots?.[id];
      if(!lots||base.choices.find(c=>c.id===id)?.wp==null){out[id]=null;continue;}
      const model=id==='go'?base.conversion:id==='fg'?base.fgMake:null,want=id==='go'?s.conversion:id==='fg'?s.fgMake:null;
      out[id]=model==null||want===model?lots:lots.map(l=>({...l,p:l.p*(l.ok?(model>0?want/model:0):(model<1?(1-want)/(1-model):0))}));
    }
    return out;
  }
  /* Score every available choice under a goal.
     state: {goal, params, horizon}  horizon in seconds, null = rest of game. */
  function evaluate(base,scenario,state,clock){
    const goal=GOALS[state?.goal];
    if(!goal)throw Error('Unknown goal.');
    if(!base?.lots)throw Error('This result carries no outcome lots.');
    const s=scenario||base,P=params(state.goal,state.params),lots=lotsFor(base,s);
    const standard=s.choices.filter(c=>c.wp!==null).sort((a,b)=>b.wp-a.wp);
    const out={goal:state.goal,label:goal.label,unit:goal.unit,params:P,path:goal.path,identity:!!goal.identity,standardBest:standard[0].id,describe:goal.describe(P),range:goal.range?.(P)??null};
    if(goal.path){
      if(!clock)return {...out,available:false,reason:'The path model did not load, so this goal cannot be scored. Win the game still works.'};
      if(base.secondsLeft<clock.abstainBelow)return {...out,available:false,reason:`Inside the final ${clock.abstainBelow} seconds the path model misses by about 10 points of clock share on held-out games, so it does not answer here.`};
    }
    const asked=state.horizon===undefined?goal.horizon:state.horizon;
    const horizon=goal.path&&asked!=null?Math.max(0,Math.min(Number(asked),base.secondsLeft)):null;
    const span=Math.max(...Object.values(lots).filter(Boolean).flatMap(l=>l.map(x=>horizon==null?x.t:Math.min(horizon,x.t))));
    const instant=goal.path&&!(span>0),ref=standard[0].wp;
    const choices=s.choices.map(c=>{
      if(c.wp===null)return {id:c.id,label:c.label,value:null,wp:null};
      let value=0;
      for(const lot of lots[c.id]){
        if(!(lot.p>0))continue;
        if(!goal.path){value+=lot.p*goal.score(lot,P);continue;}
        const path=instant?{seconds:0,share:x=>lot.wp>x?1:0,shortfall:r=>Math.max(0,r-lot.wp)}:pathFor(clock,lot,horizon);
        value+=lot.p*goal.score(lot,P,path,ref)*(goal.weigh==='time'&&!instant?path.seconds/span:1);
      }
      return {id:c.id,label:c.label,value,wp:c.wp,seconds:goal.unit==='share'?value*span:null};
    });
    // Ties (to rounding) go to the higher win probability and are reported as ties.
    const ranked=choices.filter(c=>c.value!==null).sort((a,b)=>Math.abs(b.value-a.value)>1e-9?b.value-a.value:b.wp-a.wp);
    const edge=100*Math.max(0,ranked[0].value-ranked[1].value),tie=edge<1e-7;
    return {...out,available:true,choices,best:ranked[0].id,runnerUp:ranked[1].id,edge,tie,horizonSeconds:goal.path?span:null,instant,reference:goal.needsRef?ref:null,
      agrees:ranked[0].id===standard[0].id,
      // Win probability given up by following this goal instead of the standard call.
      wpCost:100*(standard[0].wp-ranked[0].wp),
      // An edge smaller than the path model's own held-out error is not a finding.
      tooClose:goal.path&&!instant&&!tie&&clock.error!=null&&edge<100*clock.error};
  }
  /* Which choice wins as one dial moves? values: [{params?,horizon?}] patches. */
  function sweep(base,scenario,state,clock,patches){
    return patches.map(patch=>{
      const r=evaluate(base,scenario,{...state,params:{...state.params,...patch.params},horizon:'horizon' in patch?patch.horizon:state.horizon},clock);
      return r.available?{best:r.best,edge:r.edge,tie:r.tie,tooClose:r.tooClose,choices:r.choices}:{best:null};
    });
  }
  return {cdf,quantile,createClock,share,GOALS,params,lotsFor,evaluate,sweep};
});

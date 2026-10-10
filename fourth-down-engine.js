/* Browser port of nfl4th (MIT, Ben Baldwin) and nflfastR model preparation.
 * Trained artifacts and attribution: assets/fourth-down/ and docs/fourth-down.md.
 * All win probabilities are from the original decision team's perspective. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DDFourth=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const logistic=x=>1/(1+Math.exp(-x));
  const labels={go:'Go for it',fg:'Field goal',punt:'Punt'};
  function numeric(x,name,min,max,integer=true){
    if(x===null||x===undefined||x===''||!Number.isFinite(Number(x)))throw Error(`${name} is required.`);
    x=Number(x);if(x<min||x>max||(integer&&!Number.isInteger(x)))throw Error(`${name} must be ${integer?'a whole number ':''}from ${min} to ${max}.`);return x;
  }
  function validate(input){
    const s={...input};
    s.qtr=numeric(s.qtr,'Quarter',1,4);s.seconds=numeric(s.seconds,'Seconds remaining in quarter',1,900);
    s.yardline=numeric(s.yardline,'Yards from opponent goal',1,99);s.toGo=numeric(s.toGo,'Yards to go',1,s.yardline);
    s.diff=numeric(s.diff,'Score difference',-70,70);s.offTO=numeric(s.offTO,'Offense timeouts',0,3);s.defTO=numeric(s.defTO,'Defense timeouts',0,3);
    s.home=numeric(s.home,'Offense is home',0,1);s.homeKickoff=numeric(s.homeKickoff,'Home received opening kickoff',0,1);
    s.spread=numeric(s.spread,'Home expected winning margin',-30,30,false);s.total=numeric(s.total,'Pregame total',15,90,false);
    s.runoff=numeric(s.runoff??0,'Extra clock runoff',0,40);s.touchback=numeric(s.touchback??25,'Kickoff touchback spot',20,35);
    if(!['outdoors','dome','retractable'].includes(s.roof))throw Error('Choose a roof type.');
    return s;
  }
  function makeModel(meta,buffer){
    const ints=new Int32Array(buffer,meta.offset,meta.nodes*4),floats=new Float32Array(buffer,meta.offset,meta.nodes*4);
    const roots=meta.roots,classes=meta.classes,base=meta.base;
    return function(features){
      if(features.length!==meta.features)throw Error('Model feature count mismatch.');
      // XGBoost's split comparisons use float32, including feature values.
      const x=Float32Array.from(features),sums=new Float64Array(classes);
      for(let j=0;j<classes;j++)sums[j]=classes===1?Math.log(base[j]/(1-base[j])):base[j];
      for(let k=0;k<roots.length;k+=2){
        let n=roots[k]*4;
        while(ints[n]>=0){const flags=ints[n+2],v=x[flags&65535];n=(Number.isNaN(v)?((flags>>16)&1?ints[n]:ints[n+1]):v<floats[n+3]?ints[n]:ints[n+1])*4;}
        sums[roots[k+1]]+=floats[n+3];
      }
      if(classes===1)return logistic(sums[0]);
      const max=Math.max(...sums);let total=0;for(let i=0;i<classes;i++){sums[i]=Math.exp(sums[i]-max);total+=sums[i];}
      return Array.from(sums,v=>v/total);
    };
  }
  function createEngine(manifest,buffer){
    const model={};for(const [name,meta] of Object.entries(manifest.models))model[name]=makeModel(meta,buffer);
    const fgTable=new Map(manifest.kicking.fg.map(r=>[`${r.fg_model_roof}:${r.yardline_100}`,r.p]));
    const punts=new Map();for(const r of manifest.kicking.punt){if(!punts.has(r.yardline_100))punts.set(r.yardline_100,[]);punts.get(r.yardline_100).push(r);}
    function fgProbability(yardline,roof){const key=roof==='outdoors'?'11':'01';return yardline>=53?0:yardline>40?fgTable.get(`${key}:40`)*(53-yardline)/13:fgTable.get(`${key}:${yardline}`);}
    function calculate(input){
      const s=validate(input),originalHome=s.home;
      const half=(s.qtr%2?900:0)+s.seconds,game=(s.qtr<=2?1800:0)+half;
      const elapsed=(3600-game)/3600,spreadTime=s.spread*Math.exp(-4*elapsed);
      const homeTO=s.home?s.offTO:s.defTO,awayTO=s.home?s.defTO:s.offTO;
      const roof=[+(s.roof==='outdoors'),+(s.roof==='retractable'),+(s.roof==='dome')];
      const offSpread=s.home?s.spread:-s.spread,offTotal=(s.total+offSpread)/2;
      const initial={home:s.home,diff:s.diff,y:s.yardline,down:4,toGo:s.toGo,half,game,q:s.qtr};
      function halfFlip(st){
        if(st.q===2&&st.half===0){const home=1-s.homeKickoff;return {...st,home,diff:home===st.home?st.diff:-st.diff,y:100-s.touchback,down:1,toGo:10,half:1800,game:1800,q:3};}
        return st;
      }
      function after(st,{flip=false,y=st.y,diff=st.diff,runoff=0}={}){
        return halfFlip({...st,home:flip?1-st.home:st.home,diff:flip?-diff:diff,y,down:1,toGo:Math.min(10,y),half:Math.max(0,st.half-6-runoff),game:Math.max(0,st.game-6-runoff)});
      }
      function win(st){
        if(st.game===0){const own=st.home===originalHome?st.diff:-st.diff;return own>0?1:own<0?0:.5;}
        const pt=st.home?homeTO:awayTO,dt=st.home?awayTO:homeTO;
        // nfl4th's home-WP EP call retains the original offense/defense timeout
        // columns even after possession flips; preserve that feature convention.
        const epProbs=model.ep([st.half,st.y,st.home,roof[1],roof[2],roof[0],st.toGo,0,0,0,0,1,+(st.down===1),+(st.down===2),+(st.down===3),+(st.down===4),s.offTO,s.defTO]);
        const ep=epProbs.reduce((sum,p,i)=>sum+p*[7,-7,3,-3,2,-2,0][i],0);
        const homeDiff=st.home?st.diff:-st.diff;
        const homeReceive=st.q<=2?(s.homeKickoff?-1:1):0;
        let h=model.home_wp([homeReceive,spreadTime,st.home,st.half,st.game,homeDiff/Math.exp(-4*elapsed),homeDiff,st.home?ep:-ep,st.toGo,st.home?st.y:100-st.y,homeTO]);
        if(!originalHome)h=1-h;
        const e=(3600-st.game)/3600;
        const receive=+(st.q<=2&&st.home===1-s.homeKickoff);
        let p=model.wp([receive,(st.home?s.spread:-s.spread)*Math.exp(-4*e),st.home,st.half,st.game,st.diff/Math.exp(-4*e),st.diff,st.down,st.toGo,st.y,pt,dt]);
        if(st.home!==originalHome)p=1-p;
        return (h+p)/2;
      }
      function kneelWin(st){
        const dt=st.home?awayTO:homeTO;
        return st.q===4&&st.diff>0&&st.game<[120,80,40,0][dt];
      }
      function possessionWin(st){return kneelWin(st)?(st.home===originalHome?1:0):win(st);}
      const fgMake=fgProbability(s.yardline,s.roof);
      const makeState=after(initial,{flip:true,y:100-s.touchback,diff:s.diff+3});
      const missState=after(initial,{flip:true,y:Math.max(1,Math.min(80,100-s.yardline-8))});
      const makeWP=possessionWin(makeState),missWP=possessionWin(missState);
      const fgWP=fgMake*makeWP+(1-fgMake)*missWP;
      // Outcome lots: every modelled result of each choice, with its probability, the
      // win probability after it and the game clock left. They are the same terms the
      // averages below are built from, kept so other objectives can be scored on them.
      const lots={go:[],fg:fgMake>0?[{p:fgMake,wp:makeWP,t:makeState.game,ok:true},{p:1-fgMake,wp:missWP,t:missState.game,ok:false}]:null,punt:null};
      const twoProb=model.two_pt([0,0,1,...roof,offSpread,s.total,offTotal]);
      const patProb=fgProbability(15,s.roof);
      function touchdownWP(st){
        const points=[0,1,2].map(n=>win(halfFlip({...st,home:1-st.home,diff:-st.diff-n,y:100-s.touchback,down:1,toGo:10})));
        return Math.max(patProb*points[1]+(1-patProb)*points[0],twoProb*points[2]+(1-twoProb)*points[0]);
      }
      function touchdownLots(st){
        const next=n=>halfFlip({...st,home:1-st.home,diff:-st.diff-n,y:100-s.touchback,down:1,toGo:10});
        const points=[0,1,2].map(n=>win(next(n))),kick=patProb*points[1]+(1-patProb)*points[0],two=twoProb*points[2]+(1-twoProb)*points[0];
        // Same try the win-probability average assumes: whichever has the higher WP.
        return kick>=two?[{q:patProb,wp:points[1],t:next(1).game},{q:1-patProb,wp:points[0],t:next(0).game}]:[{q:twoProb,wp:points[2],t:next(2).game},{q:1-twoProb,wp:points[0],t:next(0).game}];
      }
      const gains=model.fd([4,s.toGo,s.yardline,0,1,...roof,offSpread,s.total,offTotal]);
      let goWP=0,conversion=0,successWP=0,failWP=0;
      const outcomes=new Map();gains.forEach((p,i)=>{const gain=Math.min(i-10,s.yardline);outcomes.set(gain,(outcomes.get(gain)||0)+p);});
      for(const [gain,p] of outcomes){
        const success=gain>=s.toGo,td=gain===s.yardline;
        // Before halfFlip, a touchdown still needs its PAT/2-point decision.
        let st={...initial,home:success?s.home:1-s.home,diff:success?s.diff+(td?6:0):-s.diff,y:success?s.yardline-gain:100-s.yardline+gain,down:1};
        st.toGo=Math.min(10,st.y);
        const run=6+(success&&!td?s.runoff:0);st.half=Math.max(0,half-run);st.game=Math.max(0,game-run);
        const wp=td?touchdownWP(st):possessionWin(halfFlip(st));
        if(td)for(const part of touchdownLots(st))lots.go.push({p:p*part.q,wp:part.wp,t:part.t,ok:true});
        else lots.go.push({p,wp,t:halfFlip(st).game,ok:success});
        goWP+=p*wp;if(success){conversion+=p;successWP+=p*wp;}else failWP+=p*wp;
      }
      successWP/=conversion;failWP/=(1-conversion);
      let puntWP=null;
      if(punts.has(s.yardline)){
        puntWP=0;lots.punt=[];for(const r of punts.get(s.yardline)){
          let st=after(initial,{flip:true,y:100-r.yardline_after});
          if(r.muff)st=after(initial,{y:r.yardline_after});
          if(r.yardline_after===100)st=after(initial,{y:100-s.touchback,diff:s.diff-7});
          const wp=possessionWin(st);lots.punt.push({p:r.pct,wp,t:st.game,ok:true});
          puntWP+=r.pct*wp;
        }
      }
      const choices=[{id:'go',label:labels.go,wp:goWP},{id:'fg',label:labels.fg,wp:fgMake>0?fgWP:null},{id:'punt',label:labels.punt,wp:puntWP}];
      const ranked=choices.filter(c=>c.wp!==null).sort((a,b)=>b.wp-a.wp);
      const edge=100*(ranked[0].wp-ranked[1].wp);
      const bestKick=Math.max(fgMake>0?fgWP:0,puntWP??0);
      const breakEven=successWP===failWP?null:(bestKick-failWP)/(successWP-failWP);
      const warnings=[];
      if(s.qtr===4&&s.seconds<=120)warnings.push('Late-game estimates are sensitive to clock management. Successful in-bounds conversions that permit kneeling are handled explicitly.');
      if(s.runoff)warnings.push(`Scenario assumes ${s.runoff} additional seconds run off after every successful non-touchdown conversion.`);
      if(s.touchback===25)warnings.push('Bot comparison mode uses the upstream 25-yard kickoff assumption. Select 35 yards to examine a modern touchback scenario.');
      const out={input:s,choices,best:ranked[0].id,edge,strength:edge>5?'Very strong':edge>2.5?'Strong':edge>1?'Medium':'Close call',conversion,successWP,failWP,fgMake,makeWP,missWP,goWP,fgWP,puntWP,breakEven,twoProb,patProb,warnings,model:'nfl4th browser port · 2026-09-28',computedAt:new Date().toISOString()};
      // Not enumerable: lots stay out of JSON snapshots, spreads and Toto's context.
      Object.defineProperty(out,'lots',{value:lots});Object.defineProperty(out,'secondsLeft',{value:game});
      return out;
    }
    return {calculate,fgProbability,model};
  }
  async function load(base='assets/fourth-down/'){
    const r=await fetch(base+'manifest.json');if(!r.ok)throw Error('Model manifest could not load.');const m=await r.json();
    const b=await fetch(base+m.file);if(!b.ok)throw Error('Model bundle could not load.');
    const compressed=await b.arrayBuffer();
    if(globalThis.crypto?.subtle){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',compressed)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==m.sha256)throw Error('Model download failed its integrity check. Reload to retry.');}
    if(typeof DecompressionStream==='undefined')throw Error('This calculator needs a browser with gzip decompression support. Update your browser and retry.');
    const buffer=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return createEngine(m,buffer);
  }
  return {validate,createEngine,load,labels};
});

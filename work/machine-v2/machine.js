/* ---------------- slot machine (BOZO MACHINE v2) ----------------
   Four reels in a row: left to right is 1st through 4th in the hierarchy. The
   machine lives on the board at ALL times. Before the draw it idles; it STOPS
   only when the server has actually drawn, so a stopped reel is always a result
   that already exists on the server, never a client-side roll. Reel COUNT
   follows the league's live levers.

   ⚠️ THE LEVER IS NEVER DISABLED, and that is deliberate. A pull decides nothing
   — it only ever shows what the server already wrote — so there is no state in
   which it needs to be refused. The one constraint that falls out of that:
   before the last leg lands the server has written nothing, so the reels SPIN
   AND COME BACK rather than stop. They must never park on a permutation that
   does not exist. The only moment the lever is inert is while its own reels are
   still moving.

   ⚠️ Blank on every load, for every reader, graded or not. This has been
   "simplified" into an auto-paint twice and both times almost nobody saw the
   reels move. Pulling it is the fun part. A graded week still requires the pull:
   the verdict names ONE lever, the reels show the whole drawn order.

   ⚠️ `drawnOrder` is what stops a poll re-arming the reels under your cursor —
   render() runs on a 15s timer and on every EventSource put. /bozo/next resets
   it to null, which is what re-arms the machine for a new week.

   ⚠️ Cell height is measured with offsetHeight, NOT getBoundingClientRect(). The
   cabinet's thunk keyframes rotate the machine a fraction of a degree, and a
   rotated element's bounding rect is its axis-aligned box — measuring mid-spin
   returned ~101px for a 96px window and every reel landed off its payline.

   ⚠️ No reel tease. Parking on a lever the server did not draw and then slipping
   off it is the standard near-miss trick; here it would also mean the page
   showing a hierarchy that does not exist. The sub-cell overshoot in the settle
   is momentum and returns to the true cell. Do not extend it into a tease. */

const ORD_LBL=['1st','2nd','3rd','4th','5th','6th','7th','8th'];
const REP=11;                   // repeats of the lever set down each strip

/* The order the server wrote, mirrored here so the pull handler and the reveal
   read one value. Set only by paintMachine(), only from S.order. `drawnOrder` is
   declared near the top of the page and is the revealed-this-load key. */
let serverOrder=null;
let pendingDraw=null;

/* ---- motion / audio prefs ---- */
const mq=matchMedia('(prefers-reduced-motion:reduce)');
const reduced=()=>mq.matches;
let muted=false;

/* ============================================================================
   REEL CONSTRUCTION
   ============================================================================ */
let reels=[],strips=[],reelSet=[];
/* ⚠️ offsetHeight, NOT getBoundingClientRect(). The cabinet's thunk/pull keyframes
   rotate the machine a fraction of a degree, and a rotated element's bounding rect
   is the axis-aligned box — measuring mid-animation returned ~101px for a 96px
   window and every reel landed a few pixels off its payline. offsetHeight is layout
   height and ignores transforms. */
const cellH=()=>reels[0]?reels[0].querySelector('.win').offsetHeight:104;

function buildReels(active){
  if(reelSet.join(',')===active.join(',')) return;
  reelSet=active.slice(); reels=[]; strips=[];
  const host=document.getElementById('reels');
  host.innerHTML='';
  host.style.gridTemplateColumns=`repeat(${active.length},minmax(0,1fr))`;
  active.forEach((li,i)=>{
    const r=document.createElement('div'); r.className='reel';
    r.innerHTML=`<div class="pos">${ORD_LBL[i]||(i+1)}</div><div class="win"><div class="strip"></div></div>`;
    const st=r.querySelector('.strip');
    for(let k=0;k<REP;k++) active.forEach(l=>{
      const c=document.createElement('div'); c.className='cell';
      c.innerHTML=LEVER_ICON[LEVERS[l].k]+`<span>${LEVERS[l].name}</span>`;
      st.appendChild(c);
    });
    host.appendChild(r); reels.push(r); strips.push(st);
  });
  setStrips(0);
}
const setLen=()=>reelSet.length*cellH();
function setStrips(y){ strips.forEach(s=>{s.style.transform=`translate3d(0,${y}px,0)`;}); }

/* ============================================================================
   SPIN ENGINE — rAF, per-reel velocity, blur that tracks speed, and a settle
   that overshoots by a fraction of a cell and springs back.

   ⚠️ The overshoot shows the NEIGHBOURING cell edge for ~140ms and returns. That
   is momentum, and it is honest. What is deliberately NOT here is a "reel tease"
   that parks on a lever the server did not draw and then slips off it — on a real
   book that is a near-miss dark pattern, and on this site it would also be the
   page displaying a hierarchy that does not exist. Don't add it.
   ============================================================================ */
const reelState=[];   // {y,v,phase,target,t0,from}

function reelStopY(lev){
  const pos=Math.max(0,reelSet.indexOf(lev));
  return -( (REP-3)*setLen() + pos*cellH() );
}
const IDLE_V=0.62;                       // px per ms
let rafId=null,t0=0,lastNow=0,spinning=false;
function tick(now){
  if(!spinning) return;
  const dt=Math.min(60,now-lastNow||16); lastNow=now;
  const L=setLen()||1;
  reelState.forEach((st,i)=>{
    const r=reels[i],s=strips[i];
    if(!r||!s) return;
    if(st.phase==='idle'){
      /* integrate, don't sample an absolute clock — a reel resuming from a stop
         must continue from where it is, not snap to wherever the clock says. */
      st.y-=IDLE_V*dt; while(st.y<=-L) st.y+=L;
      s.style.transform=`translate3d(0,${st.y}px,0)`;
      r.style.setProperty('--mblur','2.6px');
      r.classList.add('moving');
    }else if(st.phase==='stopping'){
      const p=Math.min(1,(now-st.t0)/st.dur);
      /* travel eases out hard over the first 88%; the last 12% is a single
         sub-cell bounce measured in PIXELS, not in a fraction of the travel —
         a percentage overshoot on a 4000px run throws the reel half a screen. */
      const trav=Math.min(1,p/.88);
      const e=1-Math.pow(1-trav,3.2);
      let y=st.from+(st.target-st.from)*e;
      if(p>.88){ const q=(p-.88)/.12; y-=Math.sin(q*Math.PI)*st.cell*.26*(1-q*.55); }
      st.y=y;
      s.style.transform=`translate3d(0,${y}px,0)`;
      const speed=Math.max(0,1-trav);
      r.style.setProperty('--mblur',(speed*speed*3.4).toFixed(2)+'px');
      if(p>=1){
        st.phase='done';
        s.style.transform=`translate3d(0,${st.target}px,0)`;
        r.classList.remove('moving');
        r.style.setProperty('--mblur','0px');
        lockReel(i);
      }
    }
  });
  rafId=requestAnimationFrame(tick);
}
/* A reel that has already stopped sits several sets down the strip. Before it can
   spin again its offset must be folded back into the first set, or the next run
   walks off the end of the strip and the window goes blank. The strip repeats, so
   the fold is invisible. */
function rewindStrips(){
  const L=setLen()||1;
  reelState.forEach((st,i)=>{
    if(!st) return;
    let y=st.y%L; if(y>0) y-=L;
    st.y=y; st.phase='idle';
    if(strips[i]) strips[i].style.transform=`translate3d(0,${y}px,0)`;
    if(reels[i]) reels[i].classList.remove('lock','pop');
  });
}

function startIdle(){
  if(!reels.length) return;
  const L=setLen()||1;
  reelState.length=0;
  // stagger the reels so the row never looks like one tall strip
  reels.forEach((r,i)=>{ reelState[i]={phase:'idle',y:-((i*0.31*L)%L)}; r.classList.remove('lock','pop'); });
  if(reduced()){ setStrips(0); reels.forEach(r=>r.classList.remove('moving')); return; }
  spinning=true; t0=lastNow=performance.now();
  cancelAnimationFrame(rafId); rafId=requestAnimationFrame(tick);
}
function stopAll(){ spinning=false; cancelAnimationFrame(rafId);
  reels.forEach(r=>{r.classList.remove('moving');r.style.setProperty('--mblur','0px');}); }

/* ============================================================================
   THE REVEAL
   ============================================================================ */
let sequenceGuard=0;
function revealSpin(order){
  const machine=document.getElementById('machine'),run=++sequenceGuard;
  document.getElementById('ord').innerHTML='';
  reels.forEach(r=>r.classList.remove('lock','pop'));

  if(reduced()){                                  // no motion: paint it, say so
    paintOrder(order); afterLock(order,run); return;
  }
  machine.classList.add('pulling');
  setTimeout(()=>machine.classList.remove('pulling'),820);
  machine.classList.remove('armed','pending','locked','spin2','spin3');
  machine.classList.add('spin1');

  rewindStrips();
  if(!spinning){ spinning=true; lastNow=performance.now(); rafId=requestAnimationFrame(tick); }

  order.forEach((lev,slot)=>{
    const last = slot===order.length-1;
    // anticipation: the reel that decides the tail spins visibly longer
    const dur = 1500 + slot*520 + (last?700:0);
    const st=reelState[slot]; if(!st) return;
    setTimeout(()=>{
      if(run!==sequenceGuard) return;
      st.phase='stopping'; st.t0=performance.now(); st.dur=dur*0.72;
      st.from=st.y; st.cell=cellH();
      // land at least ~2.5 full sets further down so the stop reads as travel
      let target=reelStopY(lev);
      while(target > st.from - setLen()*2.4) target -= setLen();
      st.target=target;
    }, 240+slot*140);
  });
  const total=240+(order.length-1)*140 + (1500+(order.length-1)*520+700)*0.72 + 120;
  setTimeout(()=>{ if(run===sequenceGuard) afterLock(order,run); }, total);
}

function lockReel(i){
  const r=reels[i]; if(!r) return;
  r.classList.add('lock','pop');
  setTimeout(()=>r.classList.remove('pop'),300);
  const m=document.getElementById('machine');
  m.classList.add('thunk'); setTimeout(()=>m.classList.remove('thunk'),170);
  // the bulb chase escalates with each reel that lands, not with the clock
  m.classList.remove('spin1','spin2','spin3');
  m.classList.add(['spin1','spin2','spin3'][Math.min(2,i)]);
  clunk(i);
  addOrd(currentOrder[i],i);
}

let currentOrder=[];
function afterLock(order,run){
  if(run!==sequenceGuard) return;
  stopAll();
  const m=document.getElementById('machine');
  m.classList.remove('spin1','spin2','spin3','pending','armed');
  m.classList.add('locked');
  if(!reduced()){ m.classList.add('jackpot'); setTimeout(()=>m.classList.remove('jackpot'),1200); coinBurst(); }
  jackpotChord();
  setLever('done');
  drawnOrder=order.join(',');
  document.getElementById('drawState').textContent='drawn · at the close';
  document.getElementById('drawNote').textContent=
    'Drawn on the server the moment the last leg landed — the reels are showing a result that already existed before you pulled. '
    +'Only legs that lost are eligible. Ties fall to the next rule down.';
  document.getElementById('marqText').textContent='HIERARCHY DRAWN';
}

function paintOrder(order){
  document.getElementById('ord').innerHTML='';
  stopAll();
  order.forEach((lev,slot)=>{
    const s=strips[slot]; if(!s) return;
    const y=reelStopY(lev);
    s.style.transform=`translate3d(0,${y}px,0)`;
    // keep reelState in step with the DOM or the next pull rewinds from stale y
    reelState[slot]=Object.assign(reelState[slot]||{},{phase:'done',y});
    reels[slot].classList.add('lock');
    addOrd(lev,slot);
  });
}
function addOrd(lev,slot){
  if(lev===undefined||lev===null) return;
  const l=LEVERS[lev],li=document.createElement('li');
  li.innerHTML=`<span class="n">${slot+1}</span><span><b>${l.name}</b> <span class="d">— ${l.desc}</span></span>`;
  document.getElementById('ord').appendChild(li);
  requestAnimationFrame(()=>li.classList.add('on'));
}
function ghostList(){
  document.getElementById('ord').innerHTML=reelSet.map(li=>
    `<li class="ghost"><span class="n">·</span><span><b>${LEVERS[li].name}</b>`
    +`<span class="d"> — ${LEVERS[li].desc}</span></span></li>`).join('');
}

/* ============================================================================
   BOARD STATES — one function owns which of the three the machine is in, so the
   disabled flag, the class, the decal and the accessible name cannot disagree.
   ============================================================================ */
function paintMachine(ord){
  const m=document.getElementById('machine');
  serverOrder = (ord && ord.length) ? ord.slice() : null;
  buildReels(activeLevers(serverOrder));
  currentOrder = serverOrder ? serverOrder.slice() : [];
  if(!serverOrder){
    m.className='machine armed';
    pendingDraw=null; drawnOrder=null;
    setLever('idle'); startIdle(); ghostList();
    document.getElementById('marqText').textContent='ARMED · ARMED · ARMED';
    document.getElementById('drawState').textContent='armed · not drawn';
    document.getElementById('drawNote').textContent=
      `${reelSet.length} lever${reelSet.length===1?'':'s'} are in the draw; the order is not decided yet. `
      +'The server draws a fresh permutation the moment the last leg lands and writes it once — these reels stop on that. '
      +'Nothing on this page can re-roll it. Pull whenever you like: until the draw exists the reels just spin and come back.';
    return;
  }
  const key=serverOrder.join(',');
  if(drawnOrder===key){ // already pulled this load — repaint statically
    m.className='machine locked'; setLever('done'); paintOrder(serverOrder);
    document.getElementById('drawState').textContent='drawn · at the close';
    document.getElementById('marqText').textContent='HIERARCHY DRAWN';
    document.getElementById('drawNote').textContent=
      'Drawn on the server the moment the last leg landed. Pull again to replay it.';
    return;
  }
  if(pendingDraw===key) return;                  // idempotent under the 15s poll
  pendingDraw=key;
  m.className='machine armed pending';
  setLever('pull'); startIdle(); ghostList();
  document.getElementById('marqText').textContent='PULL · PULL · PULL';
  document.getElementById('drawState').textContent='drawn · waiting on your pull';
  document.getElementById('drawNote').textContent=
    'The hierarchy is already decided — the server drew it the moment the last leg landed and wrote it once. '
    +'Pull the lever to watch it stop. Everyone pulls their own; the reels stop on the same order for all of us.';
}
function activeLevers(ord){
  if(ord&&ord.length) return ord.slice().sort((a,b)=>a-b);
  const l=(settings().levers||[]).slice().sort((a,b)=>a-b);
  return l.length ? l : [0,1,2,3];
}
function setLever(state){
  const lv=document.getElementById('lever'),lab=document.getElementById('pullLab');
  /* ⚠️ There is no disabled state any more, and that is deliberate. Kap's call:
     the lever is always pullable, because a pull never decides anything — it only
     shows what the server already wrote. Before the last leg lands the server has
     written nothing, so the reels spin and come back to idle rather than stopping;
     they must never stop on a permutation that does not exist. The only moment the
     lever is inert is while its own reels are still moving. */
  const cfg={
    idle:['Pull',  false, 'Pull the lever. The hierarchy has not been drawn yet, so the reels will spin and come back — there is nothing for them to stop on.'],
    pull:['Pull',  false, "Pull the lever to reveal this week's drawn hierarchy"],
    done:['Again', false, "Pull again to replay this week's drawn hierarchy"],
    busy:['· · ·', true,  'Reels are spinning']
  }[state];
  lab.textContent=cfg[0]; lv.disabled=cfg[1];
  lv.classList.toggle('live',!cfg[1]);
  lv.setAttribute('aria-label',cfg[2]);
}

/* ============================================================================
   THE PULL — one Pointer Events path for mouse / pen / touch, plus click and
   keyboard. Commit past 62% of travel; short of that it springs back.
   ============================================================================ */
const lever=document.getElementById('lever'),arm=document.getElementById('arm');
let dragging=false,pullV=0,startPt=0,moved=0,pointerId=null,lastRatchet=0;
const TRAVEL=118;   // px of pointer travel = full pull
const COMMIT=0.62;

function setPull(v,instant){
  pullV=Math.max(0,Math.min(1,v));
  arm.style.setProperty('--armT',instant?'0s':'.5s');
  arm.parentElement.style.setProperty('--pull',pullV.toFixed(3));
  arm.style.setProperty('--pull',pullV.toFixed(3));
  // ratchet clicks as the arm passes detents — the feedback the old lever had none of
  const step=Math.floor(pullV*9);
  if(step!==lastRatchet){ lastRatchet=step; if(dragging) ratchet(pullV); }
}
function canPull(){ return !lever.disabled; }

lever.addEventListener('pointerdown',e=>{
  if(!canPull()) return;
  dragging=true; pointerId=e.pointerId; startPt=coord(e); moved=0;
  lever.classList.add('dragging');
  try{lever.setPointerCapture(e.pointerId);}catch(_){}
  e.preventDefault();
});
lever.addEventListener('pointermove',e=>{
  if(!dragging||e.pointerId!==pointerId) return;
  const d=coord(e)-startPt;
  moved=Math.max(moved,Math.abs(d));
  setPull(d/TRAVEL,true);
  if(pullV>=1) commit();
});
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>
  lever.addEventListener(ev,e=>{
    if(!dragging) return;
    dragging=false; lever.classList.remove('dragging');
    if(pullV>=COMMIT) commit();
    else if(moved<7 && canPull()) commit();       // a plain click is a full pull
    else setPull(0,false);
  }));
// downward drag at every width — on a phone the arm lies on its side and its
// right-hand knob swings down, so "pull down" stays the same gesture.
function coord(e){ return e.clientY; }

lever.addEventListener('keydown',e=>{
  if(!canPull()) return;
  if(e.key===' '||e.key==='Enter'){ e.preventDefault(); if(!e.repeat) keyWind(); }
});
lever.addEventListener('keyup',e=>{ if(e.key===' '||e.key==='Enter') keyRelease(); });
let keyTimer=null;
function keyWind(){
  if(keyTimer) return;
  keyTimer=setInterval(()=>{ setPull(pullV+0.09,true); if(pullV>=1){ keyRelease(); commit(); } },26);
}
function keyRelease(){ if(keyTimer){clearInterval(keyTimer);keyTimer=null;} if(pullV<1&&pullV<COMMIT) setPull(0,false); else if(pullV<1) commit(); }

function commit(){
  if(lever.disabled) return;
  dragging=false; lever.classList.remove('dragging');
  setPull(1,true);
  setLever('busy');
  thunk();
  setTimeout(()=>setPull(0,false),380);          // the arm springs back, reels keep going
  // one pull, two outcomes, decided entirely by whether the server has written
  // an order — never by which control was used
  const ord=serverOrder;
  if(!ord||!ord.length){ emptySpin(); return; }
  revealSpin(ord);
}

/* ---- A pull on an undrawn board. It spins, it feels identical, and it lands on
   NOTHING — the reels come back to idle and the copy says why. No hierarchy is
   displayed, because none exists yet. ---- */
function emptySpin(){
  const m=document.getElementById('machine'),run=++sequenceGuard;
  m.classList.add('pulling'); setTimeout(()=>m.classList.remove('pulling'),820);
  document.getElementById('drawState').textContent='spinning · nothing drawn';
  document.getElementById('marqText').textContent='· · · · · · ·';
  if(reduced()){ setTimeout(()=>{emptyEnd(run)},400); return; }
  rewindStrips();
  if(!spinning){ spinning=true; lastNow=performance.now(); rafId=requestAnimationFrame(tick); }
  m.classList.add('spin2');
  clunk(0);
  setTimeout(()=>emptyEnd(run),1900);
}
function emptyEnd(run){
  if(run!==sequenceGuard) return;
  const m=document.getElementById('machine');
  m.classList.remove('spin1','spin2','spin3');
  m.classList.add('armed');
  setLever(serverOrder?'pull':'idle');
  document.getElementById('drawState').textContent='armed · not drawn';
  document.getElementById('marqText').textContent='ARMED · ARMED · ARMED';
  document.getElementById('drawNote').textContent=
    'Nothing to stop on yet — the hierarchy has not been drawn. The server draws it the moment the last leg '
    +'lands and writes it once; the reels stop on that and only that. Pull as often as you like in the meantime.';
  softChirp();
}

/* ============================================================================
   AUDIO — Web Audio only, no assets. Rising pitch per reel so the sequence has
   a shape, a mechanical thunk on the pull, a chord on the final lock.
   ============================================================================ */
let AC=null;
function ac(){ if(muted) return null; try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==='suspended')AC.resume(); return AC; }catch(_){return null;} }
function env(g,peak,dur,now){ g.gain.setValueAtTime(.0001,now);
  g.gain.exponentialRampToValueAtTime(peak,now+.008); g.gain.exponentialRampToValueAtTime(.0001,now+dur); }
function tone(hz,type,peak,dur,slideTo){
  const c=ac(); if(!c) return; const now=c.currentTime,g=c.createGain(),o=c.createOscillator();
  env(g,peak,dur,now); o.type=type; o.frequency.setValueAtTime(hz,now);
  if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo,now+dur*.8);
  o.connect(g); g.connect(c.destination); o.start(now); o.stop(now+dur+.02);
}
function thunk(){
  tone(84,'triangle',.24,.26,40); tone(148,'square',.14,.2,66);
  if(navigator.vibrate&&!reduced()) navigator.vibrate([38,26,58]);
}
function ratchet(v){ tone(900+v*700,'square',.035,.035); }
function clunk(i){ tone(180+i*46,'triangle',.2,.16,90+i*20); tone(700+i*120,'square',.05,.06);
  if(navigator.vibrate&&!reduced()) navigator.vibrate(18); }
function softChirp(){ tone(440,'sine',.08,.12,330); }
function jackpotChord(){
  [523,659,784,1047].forEach((hz,i)=>setTimeout(()=>tone(hz,'triangle',.13,.5),i*95));
  setTimeout(()=>tone(1568,'sine',.07,.7),420);
}

/* ============================================================================
   COINS — the payoff. Purely on the final lock, never on a near-anything.
   ============================================================================ */
function coinBurst(){
  const host=document.getElementById('coins'); if(!host) return;
  const w=host.clientWidth,h=host.clientHeight;
  for(let i=0;i<20;i++){
    const c=document.createElement('div'); c.className='coin';
    const x=w*(.2+Math.random()*.6);
    c.style.left=x+'px'; c.style.top=(h*.42)+'px';
    host.appendChild(c);
    const dx=(Math.random()-.5)*w*.75, up=-(90+Math.random()*130), dur=900+Math.random()*700;
    c.animate([
      {transform:'translate(0,0) scale(.6)',opacity:0},
      {transform:`translate(${dx*.5}px,${up}px) scale(1)`,opacity:1,offset:.35},
      {transform:`translate(${dx}px,${h*.75}px) scale(.85)`,opacity:0}
    ],{duration:dur,easing:'cubic-bezier(.3,.7,.5,1)'}).onfinish=()=>c.remove();
  }
}

/* ---------------- sound ---------------- */
document.getElementById('mute').addEventListener('click', e=>{
  muted = !muted;
  e.currentTarget.setAttribute('aria-pressed', String(muted));
  e.currentTarget.textContent = muted ? 'Sound on' : 'Sound off';
});


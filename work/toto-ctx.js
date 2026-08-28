  function ctx(){
    const POOL = window.DD_POOL || [];
    const S = state();
    if(!S || !S.settings) return "No draft state on this device yet.";
    const st = S.settings, picks = S.picks || [];
    /* ⚠️ A SNAKE LEAGUE HAS NO BUDGET. draft-leagues.html writes budget:null for one, and
       `st.budget||200` turned that into a $200 auction that does not exist — Toto quoting
       dollars left, max bids and inflation at a snake drafter is invented state, which is
       the one thing this assistant is not allowed to produce. Branch on the draft type
       instead, and say out loud that the money language does not apply. */
    const draftType = st.draftType === "snake" ? "snake" : "auction";
    const auction = draftType === "auction";
    /* ⚠️ THE PPN ROOM RENDERS ONE MONEY COLUMN. board.html?league=pepperoninipples drops
       every generic MV column and shows `lg` — the Aug 24 snapshot re-priced for that
       league — on its own. Pricing from `half` there had Toto naming dollar figures that
       appear nowhere on the reader's screen. Follow the column the board is showing. */
    const lgRoom = (window.DDLeague && DDLeague.id === "pepperoninipples")
      || new URLSearchParams(location.search).get("league") === "pepperoninipples";
    const scoring = (lgRoom && POOL.some(p => p.lg !== undefined)) ? "lg" : (st.scoring || "half");
    const MV = scoring === "lg" ? "$ PPN" : "MV";
    const val = p => +p[scoring] || 0;
    const norm = p => p==="D" ? "DST" : p;
    const teams = st.teams || [];
    const sold = new Set(picks.map(p=>p.player));

    /* A pick stores `etr`, the value the OPERATOR's page held at the moment of the sale —
       and the operator page has no `lg` column. In the PPN room that would mix a generic
       MV into a sheet of $ PPN prices, so re-read the value from the pool this page has. */
    const byName = {}; POOL.forEach(p=>{ byName[p.name]=p; });
    const pickVal = pk => scoring === "lg"
      ? (byName[pk.player] ? val(byName[pk.player]) : 0) : (+pk.etr || 0);

    const T = teams.map((t,i)=>({name:t.name, ti:i, spent:0, n:0,
      pos:{QB:0,RB:0,WR:0,TE:0,DST:0}}));
    picks.forEach(pk=>{ const t=T[pk.ti]; if(!t) return;
      t.spent+=pk.price; t.n++; const P=norm(pk.pos); if(t.pos[P]!==undefined) t.pos[P]++; });
    T.forEach(t=>{ t.left = auction ? (+st.budget||200)-t.spent : null; t.open=(st.spots||15)-t.n; });

    let remValue=0;
    POOL.forEach(p=>{ if(!sold.has(p.name) && val(p)>=1) remValue+=val(p); });
    const remDollars = auction ? T.reduce((a,t)=>a+Math.max(0,t.left),0) : 0;
    const infl = (auction && remValue>0) ? remDollars/remValue : 1;

    const L=[];
    const roster=(st.rosterSlots||[]).map(s=>`${s.count} ${s.slot}`).join(", ")||`${st.spots} roster spots`;
    L.push(`LEAGUE: ${T.length}-team ${draftType} draft, ${roster}. Scoring: ${{half14:"14-team Half PPR · derived",half:"12-team Half PPR",full:"12-team Full PPR",sf:"12-team Superflex PPR",sfhalf12:"12-team Superflex Half PPR · hybrid"}[st.scoring]||st.scoring||"half"}.${auction?` $${st.budget} budget; $0 bids are legal, so a team's max bid = its dollars left.`:` A snake draft has no budget and no bidding — teams pick in turn order. NEVER quote dollars left, a max bid, a price paid or inflation on this league; the dollar figures below are value estimates for ranking players, not money anybody spends.`}`);
    L.push(scoring === "lg"
      ? `$ PPN = this room's own price: the Aug 24, 2026 Market Value snapshot re-priced for the pepperoninipples league by value over replacement. IT IS THE ONLY MONEY COLUMN THIS ROOM SHOWS — every dollar figure below is a $ PPN figure. Call it "$ PPN", never a generic market value, and never quote a number from a format this room does not display.`
      : `MV = Market Value, a public auction-dollar snapshot dated 2026-08-24. It is not a points projection. Available formats are 10-team PPR; 12-team PPR, Half PPR, Standard, and Superflex PPR; and 14-team PPR.`);
    L.push(auction
      ? `STATE: ${picks.length} sold. Inflation ${infl.toFixed(2)}x — $${remDollars} chasing $${Math.round(remValue)} of ${MV} still on the board.`
      : `STATE: ${picks.length} of ${T.length*(st.spots||15)} picks made.`);
    L.push(auction
      ? `TEAMS (name | $ left = max bid | spots open | QB/RB/WR/TE/DST drafted):`
      : `TEAMS (name | spots open | QB/RB/WR/TE/DST drafted):`);
    // whoever is looking at this device — falls back to the operator's team if unset
    const me = (window.DDMe && window.DDMe.idx(teams));
    const my = (me==null ? st.myTeam : me);
    T.forEach((t,i)=>L.push(`${i===my?"*":"-"} ${t.name} | ${auction?`$${t.left} | `:""}${t.open} | ${t.pos.QB}/${t.pos.RB}/${t.pos.WR}/${t.pos.TE}/${t.pos.DST}${i===my?"  <-- THE TEAM I AM ASKING ABOUT (mine)":""}`));

    if(T[my]){
      const mine=picks.filter(p=>p.ti===my);
      L.push(`MY ROSTER${mine.length?"":" (no picks yet)"}:`);
      mine.forEach(p=>L.push(`- ${p.player} (${norm(p.pos)})${auction?` paid $${p.price},`:""} ${MV} $${pickVal(p)}`));
      const c=T[my].pos, flexUsed=Math.max(0,c.RB-2)+Math.max(0,c.WR-2)+Math.max(0,c.TE-1), holes=[];
      if(c.QB<1)holes.push("QB"); if(c.RB<2)holes.push((2-c.RB)+" RB"); if(c.WR<2)holes.push((2-c.WR)+" WR");
      if(c.TE<1)holes.push("TE"); const fl=Math.max(0,2-flexUsed); if(fl)holes.push(fl+" FLEX"); if(c.DST<1)holes.push("DEF");
      L.push(`MY OPEN STARTING SLOTS: ${holes.length?holes.join(", "):"none — starters filled, bench only"}. I have ${auction?`$${T[my].left} for `:""}${T[my].open} open spots.`);
    }

    L.push(`BEST AVAILABLE by position (${MV}${auction?", inflation-adjusted in parens":""}):`);
    ["QB","RB","WR","TE"].forEach(P=>{
      const av=POOL.filter(p=>p.pos===P && !sold.has(p.name) && val(p)>=1)
                   .sort((a,b)=>val(b)-val(a)).slice(0,8);
      L.push(P+": "+(av.map(p=>`${p.name} $${val(p)}${auction?` (adj $${Math.max(1,Math.round(val(p)*infl))}${p.tags&&p.tags.length?", "+p.tags.join("/"):""})`:`${p.tags&&p.tags.length?" ("+p.tags.join("/")+")":""}`}`).join("; ")||"none left worth $1+"));
    });
    // master-data layer: tags + commentary, so Toto can say WHY a player is a target or a fade
    const tagged=POOL.filter(p=>!sold.has(p.name) && val(p)>=1 && ((p.tags||[]).length || p.note))
                     .sort((a,b)=>val(b)-val(a)).slice(0,16);
    if(tagged.length){
      L.push(`SCOUTING on available players (one analyst's opinions, not facts — tags: buy = target, fade = avoid, zrb = late-round RB plan):`);
      tagged.forEach(p=>{
        const tg=(p.tags||[]).length ? " ["+p.tags.join(", ")+"]" : "";
        L.push(`- ${p.name} $${val(p)}${tg}${p.note?": "+p.note:""}`);
      });
    }
    const lastPick = picks.length ? picks[picks.length-1] : null;
    if(lastPick){
      const lp = byName[lastPick.player];
      const own=(teams[lastPick.ti]||{}).name||"?";
      const d=pickVal(lastPick)-lastPick.price;
      L.push(auction
        ? `MOST RECENT SALE: ${lastPick.player} to ${own} for $${lastPick.price} (${MV} $${pickVal(lastPick)}, ${d>=0?"under":"over"} by $${Math.abs(d)})${lp&&lp.note?" — scouting: "+lp.note:""}`
        : `MOST RECENT PICK: ${lastPick.player} to ${own} (${MV} $${pickVal(lastPick)})${lp&&lp.note?" — scouting: "+lp.note:""}`);
    }
    const rec=picks.slice(-6).reverse();
    if(rec.length){ L.push(`LAST ${rec.length} ${auction?"SALES":"PICKS"}:`); rec.forEach(p=>L.push(`- ${p.player} (${norm(p.pos)})${auction?` $${p.price}`:""} to ${(teams[p.ti]||{}).name||"?"} (${MV} $${pickVal(p)})`)); }
    return L.join("\n");
  }


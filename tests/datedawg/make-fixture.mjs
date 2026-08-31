import fs from 'fs';
// Synthetic fixture. No real data. Exercises every shape the parser must handle.
let seed=42; const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
const iso=(d)=>d.toISOString().replace('T',' ').replace('Z','');
const recs=[];
const mk=(dateStr,volume,rate,commentShare)=>{
  for(let i=0;i<volume;i++){
    const t=new Date(dateStr+'T'+String(8+(i%12)).padStart(2,'0')+':00:00.000Z');
    const matched=rnd()<rate, com=rnd()<commentShare;
    const inner=com?{timestamp:iso(t),comment:"synthetic comment"}:{timestamp:iso(t)};
    const r={like:[{timestamp:iso(t),like:[inner]}]};
    if(matched){ r.match=[{timestamp:iso(new Date(t.getTime()+36e5))}];
      if(rnd()<0.5) r.chats=[{body:"synthetic message",timestamp:iso(new Date(t.getTime()+72e5))}]; }
    recs.push(r);
  }
};
// era A (before): every volume stratum represented, low rate, lots of comments
for(const d of ['2024-01-10','2024-01-11','2024-02-05','2024-02-06','2024-03-03']) mk(d,40,0.05,0.5);
for(const d of ['2024-01-15','2024-02-15','2024-03-15'])                            mk(d,14,0.06,0.4);
for(const d of ['2024-01-20','2024-02-20','2024-03-20','2024-04-20'])               mk(d,6,0.07,0.3);
for(const d of ['2024-01-25','2024-02-25'])                                          mk(d,2,0.10,0.2);
// era B (after): same strata, higher rate, few comments
for(const d of ['2025-09-10','2025-09-11','2025-10-05','2025-10-06','2025-11-03']) mk(d,40,0.15,0.05);
for(const d of ['2025-09-15','2025-10-15','2025-11-15'])                            mk(d,14,0.16,0.05);
for(const d of ['2025-09-20','2025-10-20','2025-11-20','2025-12-20'])               mk(d,6,0.18,0);
for(const d of ['2025-09-25','2025-10-25'])                                          mk(d,2,0.20,0);
// inbound accepted + inbound declined
for(let i=0;i<25;i++) recs.push({match:[{timestamp:`2025-09-${String(1+i%28).padStart(2,'0')} 12:00:00.000`}]});
for(let i=0;i<60;i++) recs.push({block:[{block_type:"remove",timestamp:`2025-09-20 12:00:00.000`}]});
// coverage gap year: almost no blocks in 2024
recs.push({block:[{block_type:"remove",timestamp:"2024-06-01 12:00:00.000"}]});
// we_met on one connection, duplicated events (tests dedupe)
recs.push({match:[{timestamp:"2025-09-05 12:00:00.000"}],
  chats:[{body:"hi",timestamp:"2025-09-05 13:00:00.000"}],
  we_met:[{timestamp:"2025-09-09 12:00:00.000",did_meet_subject:"Yes",was_my_type:"Yes"},
          {timestamp:"2025-09-09 12:05:00.000",did_meet_subject:"Yes",was_my_type:"Yes"}]});
// malformed / defensive cases
recs.push(null,{},{like:"not-an-array"});
fs.writeFileSync('fixture-matches.json',JSON.stringify(recs));
fs.writeFileSync('fixture-user.json',JSON.stringify({
  account:{signup_time:"2024-01-01 00:00:00.000"},
  profile:{age:40,gender:"Man"},
  preferences:{age_min:18,age_max:85,age_dealbreaker:false,distance_miles_max:66},
  identity:{email:"SHOULD_BE_DROPPED@example.invalid",phone:"SYNTHETIC_PHONE_SHOULD_BE_DROPPED"},
  devices:[{ip_address:"203.0.113.9"}], installs:[{}], location:{lat:1,lon:2}}));
fs.writeFileSync('fixture-media.json',JSON.stringify(
  [1,2,3].map(i=>({type:"photo",url:"https://media.example.invalid/"+i+".jpg"}))));
console.log('fixture written:',recs.length,'records');

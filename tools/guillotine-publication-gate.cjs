// This gate is also called immediately before each automated push.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const file='data/guillotine-receipts.json';
if(fs.existsSync(file)){
 let previous=[];try{previous=JSON.parse(execFileSync('git',['show','origin/main:'+file],{stdio:['ignore','pipe','ignore']})).data;}catch{}
 const known=new Set(previous.map(r=>r.receipt_id));
 for(const r of JSON.parse(fs.readFileSync(file)).data)if(!known.has(r.receipt_id)&&Date.now()>=Date.parse(r.kickoff_at))throw Error('Guillotine receipt missed publication deadline: '+r.receipt_id);
}

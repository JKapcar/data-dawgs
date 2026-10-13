const fs=require('node:fs'),path=require('node:path'),L=require('../../dfs-ledger.js');
const read=name=>fs.readFileSync(path.join(__dirname,'dfs-ledger',name),'utf8');
const csv='Sport,Game_Type,Entry_Key,Entry,Contest_Key,Contest_Date_EST,Place,Points,Winnings_Non_Ticket,Winnings_Ticket,Contest_Entries,Entry_Fee,Prize_Pool,Places_Paid\n'+[1,2,3].map(i=>`NFL,Showdown Captain Mode,SYNTHETIC_PRIVATE_HISTORY_${i},Synthetic tied entries,synthetic-contest,2026-09-07 20:15:00,10,100,${i===3?'':'0'},50,1000,5,4000,200`).join('\n');
const account=()=>({version:2,records:L.parseHistory(csv,{filename:'synthetic-history.csv',importedAt:'2026-10-13T00:00:00Z'}),legacy_archives:[]});
const ledger=()=>L.buildLedger(JSON.parse(read('snapshot.json')),[{csv:read('contest-standings-100000001.csv'),meta:{...JSON.parse(read('contests.json'))['100000001'],contest_id:'100000001'}}],{users:['ddtester'],lockTime:'2026-09-07T17:00:00Z',objective:'first_place_upside',builtAt:'2026-09-08T00:00:00Z'});
module.exports={csv,account,ledger};

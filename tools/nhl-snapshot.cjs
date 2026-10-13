/* Build derived rates only; raw source files stay outside the public repository. */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),N=require('../dfs-nhl.js');
const sourceBase='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/';
function build(boxText,rosterText,asOf,season=2027){
 if(!Number.isInteger(season)||season<2010||season>2027)throw Error('Invalid season');
 const seasonCode=String(season-1)+String(season),cutoff=new Date(asOf).toISOString().slice(0,10);
 const objects=text=>{const [head,...rows]=N.csv(text);return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]||''])));};
 const boxes=objects(boxText);if(boxes.some(r=>r.season!==seasonCode||r.game_id.slice(0,4)!==String(season-1)))throw Error('Mixed or incorrect season');
 const roster=new Map();for(const r of objects(rosterText)){
  if(r.season!==seasonCode||r.game_id.slice(4,6)!=='02'||r.game_date>=cutoff)continue;
  const key=r.game_id+':'+r.player_id;if(roster.has(key))throw Error('Duplicate roster game/player identity');roster.set(key,r);
 }
 const h=N.history(boxText,asOf,'02'),accepted=[],rejected=[];
 for(const row of h.rows){const r=roster.get(row.gameId+':'+row.id),short=r&&r.first_name.charAt(0)+r.last_name;
  if(!r||r.game_date!==row.date||r.team_abbr!==row.team||N.norm(short)!==N.norm(row.name)||!r.full_name||((r.position_code==='G')!==(row.pos==='G'))){rejected.push({id:row.id,game:row.gameId});continue;}
  accepted.push({...row,name:r.full_name});
 }
 if(!accepted.length)throw Error('No identity-verified historical rows');
 const model=N.train(accepted,asOf);model.snapshotId='nhl-'+season+'-regular-'+cutoff;model.season=season;model.gameType='02';
 model.source='SportsDataverse NHL boxscores + game rosters; derived by DataDawgs';
 model.attribution={creator:'SportsDataverse',upstream:'NHL public API via SportsDataverse',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',licenseEvidence:'https://github.com/sportsdataverse/sportsdataverse-data/blob/c30618f5f439abc8275f0a9bea30892a598890b8/README.md',sources:[sourceBase+'nhl_player_boxscores/player_box_'+season+'.csv',sourceBase+'nhl_game_rosters/game_rosters_'+season+'.csv'],changes:'Aggregated recency-weighted per-minute rates, position shrinkage and expected minutes; full names joined by exact game/player IDs. No raw game rows republished. No endorsement or warranty.'};
 model.receipt={...h.receipt,identityAccepted:accepted.length,identityRejected:rejected.length,identityCheck:'Exact game/player IDs, team, normalized initial/surname and goalie classification against same-source game rosters; not an independent roster audit.',boxSha256:crypto.createHash('sha256').update(boxText).digest('hex'),rosterSha256:crypto.createHash('sha256').update(rosterText).digest('hex')};
 model.players.sort((a,b)=>a.nhlId.localeCompare(b.nhlId));return model;
}
module.exports={build};
if(require.main===module){const [boxes,rosters,asOf,out]=process.argv.slice(2);if(!out)throw Error('Usage: node tools/nhl-snapshot.cjs box.csv game_rosters.csv ISO-as-of output.js');const model=build(fs.readFileSync(boxes,'utf8'),fs.readFileSync(rosters,'utf8'),asOf);fs.writeFileSync(out,'/* Derived NHL snapshot; attribution and source receipts in payload. */\n(function(root){const model='+JSON.stringify(model)+';if(typeof module!=="undefined"&&module.exports)module.exports=model;else root.DDNHLSnapshot=model;})(typeof window!=="undefined"?window:globalThis);\n');console.log(JSON.stringify({snapshot:model.snapshotId,players:model.players.length,receipt:model.receipt}));}

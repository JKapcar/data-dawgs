/* Local reproducible recipe. No account credentials, scheduler or deployment. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),N=require('../dfs-nhl.js'),H=require('./nhl-player-history.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function compare(current,previous){const old=new Map((previous?.players||[]).map(p=>[p.nhlId,p]));return current.players.map(p=>{const before=old.get(p.nhlId);return {nhlId:p.nhlId,name:p.name,status:!before?'new':!before.baseline?'previous method not comparable':'comparable',priorN:before?.baseline?.n??null,currentN:p.baseline.n,priorMean:before?.baseline?.mean??null,currentMean:p.baseline.mean,meanChange:before?.baseline? p.baseline.mean-before.baseline.mean:null,priorTeam:before?.team??null,currentTeam:p.team};}).concat((previous?.players||[]).filter(p=>!current.players.some(q=>q.nhlId===p.nhlId)).map(p=>({nhlId:p.nhlId,name:p.name,status:'removed'})));}
function readModel(file){return file.endsWith('.json')?JSON.parse(fs.readFileSync(file,'utf8')):require(path.resolve(file));}
async function run(args){
 const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'docs/nhl-projection-recipe.json'),'utf8'));
 if(JSON.stringify(config.seasons)!=='[2025,2026,2027]'||config.gameType!=='02'||config.modelVersion!=='player-history/1')throw Error('Recipe and builder version mismatch');
 if(!args.output||!args.asOf||(!args.inputs&&!args.download))throw Error('Use --as-of ISO --output private-new-directory and either --inputs local-directory or --download');
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(args.asOf)||!Number.isFinite(Date.parse(args.asOf))||Date.parse(args.asOf)>Date.now())throw Error('Cutoff must be a valid non-future ISO timestamp with timezone');
 args={...args,asOf:new Date(args.asOf).toISOString()};
 const output=path.resolve(args.output);if(output===root||output.startsWith(root+path.sep))throw Error('Keep raw-source runs outside this public repository');if(fs.existsSync(output))throw Error('Output already exists; use a new directory to preserve the previous run');
 const baseFile=path.resolve(args.seed||path.join(root,'dfs-nhl-model.js')),base=readModel(baseFile),previous=args.previous?readModel(path.resolve(args.previous)):base;
 fs.mkdirSync(path.join(output,'inputs'),{recursive:true});const inputs=path.join(output,'inputs'),inputReceipts=[];
 for(const season of config.seasons)for(const {prefix,tag} of config.sources){const filename=prefix+'_'+season+'.csv',url=config.sourceBase+tag+'/'+filename;let bytes;
  if(args.download){const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Source fetch failed '+response.status+' '+url);bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8000000)throw Error('Source exceeds validated CSV limit');}
  else bytes=fs.readFileSync(path.join(path.resolve(args.inputs),filename));
  fs.writeFileSync(path.join(inputs,filename),bytes);inputReceipts.push({filename,url,bytes:bytes.length,sha256:sha(bytes)});
 }
 fs.writeFileSync(path.join(output,'identity-seed.json'),JSON.stringify(base));fs.writeFileSync(path.join(output,'previous-model.json'),JSON.stringify(previous));
 const result=H.build(inputs,base,args.asOf);N.validate({version:1,platform:'dk',players:[],roster:Array(9).fill(null),slate:{id:'',date:'',games:[]},model:result.model,synthetic:false});
 const comparison=compare(result.model,previous),csv=N.projectionCsv(result.model),workbook={schemaVersion:1,model:result.model,backtest:result.backtest,comparison,notes:config.limitations};
 const files={'model.json':JSON.stringify(result.model),'projections.csv':csv,'backtest.json':JSON.stringify(result.backtest,null,2),'comparison.json':JSON.stringify(comparison,null,2),'workbook-data.json':JSON.stringify(workbook)};
 const audit={recipe:config,scoringSnapshot:N.RULES.dk,asOf:args.asOf,identitySeedJsonSha256:sha(JSON.stringify(base)),previousModelJsonSha256:sha(JSON.stringify(previous)),identitySeedSha256:sha(fs.readFileSync(baseFile)),previousSnapshot:previous.snapshotId,codeHashes:Object.fromEntries(['dfs-nhl.js','tools/nhl-player-history.cjs','tools/nhl-refresh.cjs'].map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),inputs:inputReceipts,outputs:Object.fromEntries(Object.entries(files).map(([name,data])=>[name,{bytes:Buffer.byteLength(data),sha256:sha(data)}])),validation:{players:result.model.players.length,goalies:result.model.players.filter(p=>p.pos==='G').length,acceptedAppearances:result.model.historicalReceipt.acceptedAppearances,componentReconciliation:'passed by model validation',chronologicalBacktest:'same-date targets withheld together',slateReady:false},freshness:result.model.historicalReceipt.sources.filter(x=>x.season).map(x=>({season:x.season,sourceMaxDate:x.maxDate,trainingMaxDate:x.trainingMaxDate})),missingInputs:config.limitations};
 for(const [name,data] of Object.entries(files))fs.writeFileSync(path.join(output,name),data);fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(audit,null,2));return audit;
}
module.exports={run,compare};
if(require.main===module){const args={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--download')args.download=true;else if(['--as-of','--output','--inputs','--previous','--seed'].includes(key))args[key==='--as-of'?'asOf':key.slice(2)]=process.argv[++i];else throw Error('Unknown argument '+key);}run(args).then(a=>console.log(JSON.stringify({outputs:a.outputs,validation:a.validation,freshness:a.freshness},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}

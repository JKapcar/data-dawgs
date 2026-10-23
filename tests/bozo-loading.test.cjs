// Isolated read paths from the shipped page; no production requests or writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../bozo.html'),'utf8');
const lift=name=>html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))[0];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function fixture(){
 const nodes=new Map(),watched=[],timers=[];
 const c={ME:{session:'fixture-a'},LID:'main',LEAGUES:[],ROSTER:[],S:{},directoryState:'loading',directoryRequest:0,rosterRequest:0,boardReady:false,stateGeneration:0,watchedLeague:null,stateReader:null,
 location:{search:'?l=royale'},URLSearchParams,document:{createElement(){return {};},getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',append(){}});return nodes.get(id);}},setTimeout(fn){timers.push(fn);},paintHub(){},renderAuth(){c.paints++;},paints:0,
 paintConnection(){},watchState(){c.watchedLeague=c.LID;watched.push(c.LID);},wGet:async()=>({leagues:[]})};
 vm.createContext(c);vm.runInContext(lift('loadLeagues')+'\n'+lift('loadRoster'),c);
 return {c,watched,timers,nodes};
}
test('directory starts selected authorized board and paints without waiting for roster',async()=>{
 const {c,watched}=fixture(),roster=deferred();
 c.wGet=path=>path==='/auth/roster'?roster.promise:Promise.resolve({leagues:[{id:'royale'}]});
 const pending=c.loadRoster();await c.loadLeagues();assert.deepEqual(watched,['royale']);assert.equal(c.paints,1);
 roster.resolve({players:[]});await pending;assert.equal(c.paints,2);
});
test('old identity responses cannot publish a private directory or roster',async()=>{
 const {c,watched}=fixture(),response=deferred();c.wGet=()=>response.promise;
 const directory=c.loadLeagues(),roster=c.loadRoster();c.ME={session:'fixture-b'};
 response.resolve({leagues:[{id:'royale'}],players:[{name:'private fixture'}]});await Promise.all([directory,roster]);
 assert.equal(c.LEAGUES.length,0);assert.equal(c.ROSTER.length,0);assert.deepEqual(watched,[]);
});
test('latest directory response wins and denied explicit league never falls back to another contest',async()=>{
 const {c,watched}=fixture(),old=deferred();c.wGet=()=>old.promise;const pending=c.loadLeagues();
 c.wGet=async()=>({leagues:[{id:'main'}],defaultLeague:'main'});await c.loadLeagues();
 old.resolve({leagues:[{id:'royale'}]});await pending;
 assert.deepEqual(watched,[]);assert.equal(c.LEAGUES[0].id,'main');assert.equal(c.boardReady,false);
});
test('failed directory retries once and can recover',async()=>{
 const {c,timers,watched}=fixture();c.wGet=async()=>{throw Error('fixture offline');};await c.loadLeagues();
 assert.equal(c.directoryState,'error');assert.equal(timers.length,1);await c.loadLeagues(1);assert.equal(timers.length,1);
 c.wGet=async()=>({leagues:[{id:'royale'}]});await c.loadLeagues();assert.equal(c.directoryState,'ready');assert.deepEqual(watched,['royale']);
});
test('Worker read deadline covers a stalled body and aborts; writes remain outside this helper',async()=>{
 let deadline,aborted=false;const c={ME:null,WORKER:'https://synthetic.invalid',bust:()=>'',AbortController,Promise,
 setTimeout(fn){deadline=fn;return 1;},clearTimeout(){},fetch:async(u,o)=>{o.signal.addEventListener('abort',()=>aborted=true);return {ok:true,json:()=>new Promise(()=>{})};}};
 vm.createContext(c);vm.runInContext(lift('wGet'),c);const request=c.wGet('/league/list');await Promise.resolve();deadline();
 await assert.rejects(request,/Read timed out/);assert.equal(aborted,true);
});
test('hub distinguishes pending and empty state without requiring directory metadata',()=>{
 const nodes=new Map();const c={boardReady:false,stateConnection:{state:'loading'},LID:'main',S:{},names:()=>[],stateMembers:()=>[],league:()=>null,
 document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},body:{classList:{remove(){}}}},paintBozoTonight(){}};
 vm.createContext(c);vm.runInContext(lift('paintHouseTicket'),c);c.paintHouseTicket();assert.match(nodes.get('houseSlip').innerHTML,/Loading the live/);
 c.boardReady=true;c.paintHouseTicket();assert.match(nodes.get('houseSlip').innerHTML,/no members yet/);assert.doesNotMatch(nodes.get('houseSlip').innerHTML,/unreachable/);
});
test('a /scores answer for a week the board has left cannot repaint the slate',async()=>{
 const nodes=new Map(),late=deferred(),painted=[];
 const week7={games:[{id:'w7',start:'2026-10-25T17:00:00Z'}],window:{week:7,loDate:'2026-10-22',hiDate:'2026-10-26'}};
 const c={S:{},GAMES:{},WEEK_WINDOW:null,ESPN_PATH:{nfl:'football/nfl'},prefillFromMyLeg(){},paintGames(){painted.push(c.GAMES.nfl.map(g=>g.id));},
 document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:''});return nodes.get(id);}},
 wGet:path=>/[?&]week=1(&|$)/.test(path)?late.promise:Promise.resolve(week7)};
 vm.createContext(c);vm.runInContext(['bozoWeekNum','easternDate','inWeekWindow','fetchScores','loadGames'].map(lift).join('\n'),c);
 const first=c.loadGames('nfl');                       // S is still empty, so this asks for Week 1
 c.S={week:7};c.WEEK_WINDOW=null;c.GAMES={};await c.loadGames('nfl');   // what the first board answer does
 late.resolve({games:[{id:'w1',start:'2026-09-13T17:00:00Z'}],window:{week:1,loDate:'2026-09-10',hiDate:'2026-09-14'}});await first;
 assert.equal(c.WEEK_WINDOW.week,7);assert.deepEqual(painted,[['w7']]);assert.match(nodes.get('srcNote').textContent,/^Week 7 slate/);
});
test('init asks for no slate before the board knows its week',()=>{
 const init=html.match(/\(async function init\(\)\{[\s\S]*?\n\}\)\(\);/)[0].replace(/\/\/.*$/gm,'');
 assert.doesNotMatch(init,/loadGames\(/);assert.match(lift('watchState'),/loadGames\(/);
});
test('rules come from the board node until the directory answers, exactly as the Worker derives them',()=>{
 const worker=fs.readFileSync(require('node:path').join(__dirname,'../dawg-bot-worker.js'),'utf8');
 const w={};vm.createContext(w);vm.runInContext(worker.match(/const SETTING_DEFAULTS = \{[\s\S]*?\};/)[0]+'\n'+worker.match(/const settingsOf = lg => \(\{[\s\S]*?\}\);/)[0]+'\nthis.settingsOf=settingsOf;',w);
 const c={S:{},league:()=>null};vm.createContext(c);
 vm.runInContext(html.match(/const boardSettings = [\s\S]*?\}\);/)[0]+'\n'+html.match(/function settings\(\)\{[^\n]*\}/)[0],c);
 const plain=o=>JSON.parse(JSON.stringify(o)),page=()=>plain(c.settings()),viaWorker=node=>{const {dupesRetired,...rest}=plain(w.settingsOf(node));return rest;};
 assert.deepEqual(page(),{stake:50,allowEdit:true,lockRule:'all',lockCount:0,levers:[0,1,2,3],format:'standard',buyback:0,formatLocked:false,synthetic:false});
 for(const node of [{},{stake:25,format:'royale',buyback:10,lockRule:'count',lockCount:3,levers:[2,0],allowEdit:false,formatLocked:true},{stake:'25',levers:[],format:'odd',synthetic:true}]){
  c.S=node;assert.deepEqual(page(),viaWorker(node));
 }
 c.S={stake:25};c.league=()=>({settings:{stake:75}});assert.equal(c.settings().stake,75);
});

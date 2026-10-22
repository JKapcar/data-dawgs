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

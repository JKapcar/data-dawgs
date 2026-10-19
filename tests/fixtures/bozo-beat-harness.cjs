const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.join(__dirname,'../..');
const page=fs.readFileSync(path.join(root,'bozo.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'dawg-bot-worker.js'),'utf8');
function lift(s,name){const m=s.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));if(!m && ['moneylineBeat','worstBeatRuleFor'].includes(name))return '';if(!m)throw Error(name);return m[0];}
function between(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<=start)throw Error('Missing markers: '+a+' / '+b);return s.slice(start,end);}
function build(page,worker){
  const ui=vm.createContext({});
  vm.runInContext(between(page,'const SPORTS =','const LEVERS =')+'\n'+
    between(page,'const imp  =','// Acklam')+'\n'+
    ['invNorm','sdOf','worstBeatRuleFor','moneylineBeat','legEdge','beatDeficit','beatOf','binaryBeatOf'].map(n=>lift(page,n)).join('\n')+
    '\nconst PERIOD_FRACTION={game:1,"1h":.5,"2h":.5,"1q":.25,"2q":.25,"3q":.25,"4q":.25};\nconst dirOf=x=>(x.dir||x.side)==="under"?"under":"over";',ui);
  const server=vm.createContext({playerName:k=>k});
  vm.runInContext(between(worker,'const ROYALE_LEVER_NAMES =','/* ---------------- roster state')+'\n'+
    'const BOZO_PERIOD_FRACTION={game:1,"1h":.5,"2h":.5,"1q":.25,"2q":.25,"3q":.25,"4q":.25};const bozoPeriodOf=x=>x.period||"game";',server);
  return {ui,server};
}
module.exports={page,worker,build,...build(page,worker)};

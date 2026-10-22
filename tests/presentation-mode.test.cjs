const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),paths=[...fs.readdirSync(root).filter(p=>p.endsWith('.html')),...fs.readdirSync(path.join(root,'research-lab')).filter(p=>p.endsWith('.html')).map(p=>'research-lab/'+p)];
test('all 60 integrated pages restore presentation in the head with early styles',()=>{
 assert.equal(paths.length,60);
 for(const p of paths){
  const source=fs.readFileSync(path.join(root,p),'utf8'),head=source.split('</head>')[0];
  if(p==='datedawg.html'){assert.match(head,/<script id="dd-presentation-inline">/);assert.match(head,/<style id="dd-presentation-early">/);}
  else {assert.match(head,/<script src="(?:\.\.\/)?presentation-mode.js"><\/script>/,p);assert.match(head,/<link rel="stylesheet" href="(?:\.\.\/)?presentation-mode.css">/,p);}
 }
});

test('shared script compiles and contains no account or network operations',()=>{const s=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8');new vm.Script(s);assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/);assert.match(s,/dd:presentation:v1:/);});
test('protected model and data files are unchanged',()=>{assert.equal(cp.execFileSync('git',['diff','--name-only','--','work/dfs-engine.js','data','dawg-bot-worker.js','research-lab/app-permissions.mjs','research-lab/account.js'],{cwd:root,encoding:'utf8'}),'');});

test('CSP stylesheet matches shared inline style exactly',()=>{const s=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8');assert.equal(fs.readFileSync(path.join(root,'presentation-mode.css'),'utf8'),s.match(/style.textContent = `([\s\S]*?)`;/)[1]);});

test('service-worker revision includes final shared assets',()=>{
 cp.execFileSync(process.execPath,['work/verify-sw.mjs'],{cwd:root});
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.match(sw,/"\/presentation-mode.js", "\/presentation-mode.css"/);
});

test('approved accounting engine is identical to its reviewed artifact after Git LF normalization',()=>{assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dfs-showdown.js'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),'1b6f6eadab20392f747a8f1bee784dd541fa6357036cbe5e83a2decdf39228b2');});

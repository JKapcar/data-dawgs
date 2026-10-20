const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),paths=[...fs.readdirSync(root).filter(p=>p.endsWith('.html')),...fs.readdirSync(path.join(root,'research-lab')).filter(p=>p.endsWith('.html')).map(p=>'research-lab/'+p)];
test('59 page sources retain original bytes; Showdown is separately integrated',()=>{assert.equal(paths.length,60);for(const p of paths){if(p==='dfs-showdown.html')continue;const current=fs.readFileSync(path.join(root,p),'utf8'),before=require('./fixtures/presentation-source-hashes.json')[p],tag=p==='datedawg.html'?'<script id="dd-presentation-inline">\n'+fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8')+'\n</script>\n':'<script src="'+(p.includes('/')?'../':'')+'presentation-mode.js" defer></script>\n';assert.equal(current.split(tag).length,2,p+' one hook');assert.equal(require('node:crypto').createHash('sha256').update(current.replace(tag,'')).digest('hex'),before,p+' original source untouched');}});
test('shared script compiles and contains no account or network operations',()=>{const s=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8');new vm.Script(s);assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/);assert.match(s,/dd:presentation:v1:/);});
test('protected model and data files are unchanged',()=>{assert.equal(cp.execFileSync('git',['diff','--name-only','--','work/dfs-engine.js','data','dawg-bot-worker.js','research-lab/app-permissions.mjs','research-lab/account.js'],{cwd:root,encoding:'utf8'}),'');});

test('CSP stylesheet matches shared inline style exactly',()=>{const s=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8');assert.equal(fs.readFileSync(path.join(root,'presentation-mode.css'),'utf8'),s.match(/style.textContent = `([\s\S]*?)`;/)[1]);});

test('service-worker revision includes final shared script and both assets',()=>{
 const files=fs.readdirSync(root).filter(p=>/\.(html|js)$/.test(p)&&p!=='sw.js').sort().concat(fs.readdirSync(path.join(root,'research-lab')).filter(p=>/\.(html|js|mjs|css)$/.test(p)&&!p.includes('.test.')).sort().map(p=>'research-lab/'+p));
 const hash=require('node:crypto').createHash('md5');for(const p of files)hash.update(fs.readFileSync(path.join(root,p)));
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.equal(sw.match(/const VERSION = "([^"]+)"/)[1],hash.digest('hex').slice(0,10));assert.match(sw,/"\/presentation-mode.js", "\/presentation-mode.css"/);
});

test('approved accounting engine is identical to its reviewed artifact after Git LF normalization',()=>{assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dfs-showdown.js'))).digest('hex'),'1b6f6eadab20392f747a8f1bee784dd541fa6357036cbe5e83a2decdf39228b2');});

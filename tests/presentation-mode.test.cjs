const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),paths=[...fs.readdirSync(root).filter(p=>p.endsWith('.html')),...fs.readdirSync(path.join(root,'research-lab')).filter(p=>p.endsWith('.html')).map(p=>'research-lab/'+p)];
test('all 61 integrated pages load the View script deferred and restore layout-changing choices inline',()=>{
 assert.equal(paths.length,61);
 const js=fs.readFileSync(path.join(root,'presentation-mode.js'),'utf8'),maps={};
 vm.runInNewContext(js.match(/const sections = \{[\s\S]*?\};/)[0]+js.match(/const compact = new Set\(\[[^\]]*\]\);/)[0]+'this.sections=sections;this.compact=[...compact];',maps);
 // The inline restore reads the same key the shared script writes.
 assert.match(js,/const page = location\.pathname\.replace\(\/\\\/\$\/, '\/index\.html'\);/);assert.match(js,/const key = 'dd:presentation:v1:' \+ page;/);
 for(const p of paths){
  const source=fs.readFileSync(path.join(root,p),'utf8'),head=source.split('</head>')[0],name=p.split('/').pop();
  if(p==='datedawg.html'){assert.match(head,/<script id="dd-presentation-inline">/);assert.match(head,/<style id="dd-presentation-early">/);continue;}
  assert.match(head,/<script src="(?:\.\.\/)?presentation-mode.js" defer><\/script>/,p);
  // Nothing from the View control may hold first paint: no head stylesheet, no parser-blocking script.
  assert.doesNotMatch(head,/<link[^>]+presentation-mode\.css/,p);assert.doesNotMatch(head,/<script src="(?:\.\.\/)?presentation-mode.js">/,p);
  const early=head.match(/<style data-dd-view-early>([^<]*)<\/style>/);
  if(!maps.sections[name]){assert.equal(early,null,p);continue;}
  assert.match(head,/<script data-dd-view-early>[^<]*localStorage\.getItem\("dd:presentation:v1:"\+location\.pathname\.replace\(\/\\\/\$\/,"\/index\.html"\)\)==="agent"/,p);
  for(const id of maps.sections[name])assert.ok(early[1].includes(`html:not([data-dd-view="agent"]) #${id}{display:none!important}`),p+' hides #'+id);
  assert.equal(early[1].includes('.p-kicker'),maps.compact.includes(name),p+' kicker');
  assert.ok(head.indexOf('data-dd-view-early')<head.indexOf('presentation-mode.js'),p);
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

// Render the small Markdown subset used by our canonical guide into the app.
// No runtime Markdown fetch or third-party dependency; plain HTML is readable by AIs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const md=fs.readFileSync(path.join(root,'docs/dfs-playbook.md'),'utf8');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/https:\/\/[^\s<]+/g,url=>{
  const clean=url.replace(/[.;]$/,'');return `<a href="${clean}">${clean}</a>`+url.slice(clean.length);
});
const blocks=md.trim().split(/\n\s*\n/);
const html=blocks.map(block=>{
  const lines=block.split('\n');
  if(block.startsWith('# '))return '';
  if(block.startsWith('## '))return '<h3>'+inline(block.slice(3))+'</h3>';
  if(lines.every(l=>l.startsWith('- ')))return '<ul>'+lines.map(l=>'<li>'+inline(l.slice(2))+'</li>').join('')+'</ul>';
  if(lines.every(l=>l.startsWith('|'))){
    const rows=lines.filter(l=>!/^\|[\s:|\-]+\|$/.test(l)).map(l=>l.slice(1,-1).split('|').map(c=>c.trim()));
    return '<div class="tscroll"><table class="dtab"><thead><tr>'+rows[0].map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(1).map(row=>'<tr>'+row.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  return '<p>'+inline(block.replaceAll('\n',' '))+'</p>';
}).filter(Boolean).join('\n');
const prompt=md.match(/## The short instruction to give your AI\n\n([^\n]+)/)?.[1];
if(!prompt)throw new Error('Missing AI starter');
const start='<!-- DFS PLAYBOOK START: generated from docs/dfs-playbook.md -->';
const end='<!-- DFS PLAYBOOK END -->';
const section=`${start}
<section class="card" id="dfsPlaybook" aria-labelledby="dfsPlaybookTitle">
  <h2 id="dfsPlaybookTitle">DFS Labs Playbook</h2>
  <p class="sub">One guide for you and your AI: load your data, build for each contest, and check the final entries.</p>
  <div class="btnrow"><button class="btn" type="button" id="dfsCopyStarter">Copy AI starter</button><a class="btn ghost" href="docs/dfs-playbook.md">AI-readable guide</a></div>
  <p class="note" id="dfsStarterStatus" role="status" aria-live="polite">Give your AI your workspace name and contest screenshots with this starter.</p>
  <label id="dfsStarterFallback" hidden>Copy this instruction<textarea class="fi" id="dfsStarterText" readonly rows="6" data-ddb-skip>${esc(prompt)}</textarea></label>
  <details id="dfsGuide"><summary>Read the full playbook · tools, contest strategy and final checks</summary>
  ${html}
  </details>
</section>
<style>#dfsPlaybook h2{margin-top:0}#dfsGuide{margin-top:16px}#dfsGuide summary{cursor:pointer;font-weight:700}#dfsGuide h3{margin-top:24px}#dfsGuide p,#dfsGuide li{line-height:1.65;overflow-wrap:anywhere}#dfsGuide li{margin:8px 0}#dfsGuide .dtab{min-width:640px}#dfsGuide td,#dfsGuide th{white-space:normal;vertical-align:top}#dfsStarterFallback{margin-top:12px}#dfsStarterFallback[hidden]{display:none}#dfsStarterText{width:100%;margin-top:8px}</style>
<script defer src="dfs-playbook.js"></script>
${end}`;
const file=path.join(root,'dfs.html');let page=fs.readFileSync(file,'utf8');
if(page.includes(start)){
  const a=page.indexOf(start),b=page.indexOf(end,a);
  if(b<0)throw new Error('Missing playbook end marker');
  page=page.slice(0,a)+section+page.slice(b+end.length);
}else{
  const anchor='  <div class="fsstrip" id="fsStrip"></div>';
  if(page.split(anchor).length!==2)throw new Error('Ambiguous playbook position');
  page=page.replace(anchor,section+'\n\n'+anchor);
}
fs.writeFileSync(file,page);console.log('Synced DFS playbook to dfs.html');

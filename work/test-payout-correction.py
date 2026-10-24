"""Local verification only. Logs are written to an explicitly selected output folder."""
import pathlib,subprocess,sys,json
root=pathlib.Path(__file__).resolve().parent.parent
out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
commands=[
 ['node','--test',*map(str,sorted(p.relative_to(root) for p in (root/'tests').glob('dfs-*.test.*'))),'tests/service-worker.test.js'],
 *[['node','work/'+n] for n in ['test-dfs-page.js','test-dfs-main-slate.cjs','test-dfs-selection.js','test-dfs-lab-contests.js','test-sim-v2.js','test-dfs-workspace.mjs','test-dfs-draft-workspace.mjs','test-dfs-portfolio-workspace.mjs','test-dfs-history-workspace.mjs','test-mcp.mjs']],
 ['node','tools/validate-data.js'],['node','--check','dawg-bot-worker.js'],['node','--check','sw.js'],['node','work/payout-ranking-receipt.cjs']]
results=[]
for i,cmd in enumerate(commands):
 p=subprocess.run(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 filename='ranking.json' if i==len(commands)-1 else f'check-{i:02}.log'
 (out/filename).write_bytes(p.stdout)
 results.append({'command':cmd,'exit':p.returncode,'log':filename})
 print(i,p.returncode,' '.join(cmd[:3]),flush=True)
(out/'checks.json').write_text(json.dumps(results,indent=2))
sys.exit(any(x['exit'] for x in results))

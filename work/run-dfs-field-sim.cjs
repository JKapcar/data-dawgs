// Reads/writes only explicitly selected local files. No network or automatic saves.
const fs=require('node:fs/promises'),path=require('node:path'),S=require('./dfs-field-sim.js');
async function main(){
 const [input,output,...extra]=process.argv.slice(2);
 if(!input||!output||extra.length)throw Error('Usage: node work/run-dfs-field-sim.cjs <private-evidence.json> <private-new-receipt.json>');
 const destination=path.resolve(output),repo=path.resolve(__dirname,'..'),relative=path.relative(repo,destination),inside=!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
 if(inside&&!relative.startsWith(path.join('work','artifacts')+path.sep))throw Error('Choose a private output outside the public checkout or inside ignored work/artifacts.');
 if(path.resolve(input)===destination)throw Error('Input and output must be different files.');
 const stat=await fs.stat(input);if(stat.size>20000000)throw Error('Evidence exceeds 20 MB.');
 const data=JSON.parse(await fs.readFile(input,'utf8')),result=await S.run(data);
 await fs.writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(`${result.status}: ${destination}`);
 if(result.status==='unavailable'){console.error(result.reasons.join('\n'));process.exitCode=2;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

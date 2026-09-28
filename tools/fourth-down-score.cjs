/* Compute the same recommendations for the dated, machine-readable weekly board. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.join(__dirname,'..'),E=require('../fourth-down-engine.js');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/fourth-down/manifest.json')));
const b=zlib.gunzipSync(fs.readFileSync(path.join(root,'assets/fourth-down',manifest.file)));
const engine=E.createEngine(manifest,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const file=path.join(root,'data/fourth-down.json'),env=JSON.parse(fs.readFileSync(file));
let scored=0;for(const g of env.data.games)for(const d of g.decisions){
  try{d.result=engine.calculate(d.input);delete d.result.computedAt;delete d.result.input;delete d.error;scored++;}
  catch(e){delete d.result;d.error=e.message;}
}
fs.writeFileSync(file,JSON.stringify(env)+'\n');console.log(`Scored ${scored} decisions.`);

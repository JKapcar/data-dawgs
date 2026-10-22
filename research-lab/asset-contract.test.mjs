import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readLocalAsset} from './server.mjs';
import {buildWorker} from './build-worker.mjs';

// Walk static imports recursively, including re-exports. No browser routing,
// network mocks, socket binding, or handwritten list of expected dependencies.
function moduleClosure(load,entry='/app.mjs') {
  const seen=new Set();
  function visit(file){
    if(seen.has(file))return;seen.add(file);
    const asset=load(file);assert.ok(asset,`Missing served module: ${file}`);
    assert.equal(asset.type,'text/javascript',`Module MIME: ${file}`);
    for(const match of asset.body.toString().matchAll(/\b(?:import|export)\s+(?:[^;'"`]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g)){
      visit(new URL(match[1],'http://asset.test'+file).pathname);
    }
  }
  visit(entry);return seen;
}
test('actual local HTTP asset resolver serves complete app module closure',()=>{
  const files=moduleClosure(readLocalAsset);
  assert.ok(files.has('/continuation.mjs'));assert.ok(files.has('/coordinator.mjs'));
  assert.ok(files.has('/client-config.mjs'));assert.ok(files.has('/tracking.mjs'));
  assert.equal(readLocalAsset('/not-allowed.mjs'),null);
  assert.equal(readLocalAsset('/../machine.mjs'),null);
  assert.equal(readLocalAsset('/client-config.mjs').body.toString(),"export default {mode:'local'};");
  assert.deepEqual(readLocalAsset('/continuation.mjs').body,readFileSync(new URL('./continuation.mjs',import.meta.url)));
});
test('actual Worker build ships complete dashboard module closure',()=>{
  const destination=mkdtempSync(path.join(tmpdir(),'bdb-asset-contract-'));
  buildWorker(destination);
  const load=file=>({body:readFileSync(path.join(destination,'dashboard',file)),type:'text/javascript'});
  const files=moduleClosure(load);
  assert.ok(files.has('/continuation.mjs'));assert.ok(files.has('/coordinator.mjs'));
  assert.ok(files.has('/execution-identity.mjs'));
  const workerFiles=moduleClosure(file=>({body:readFileSync(path.join(destination,file)),type:'text/javascript'}),'/worker.mjs');
  assert.ok(workerFiles.has('/execution-identity.mjs'));assert.ok(workerFiles.has('/machine-core.mjs'));
  for(const file of files)assert.deepEqual(load(file).body,readFileSync(new URL('.'+file,import.meta.url)),`Packaged source parity: ${file}`);
  assert.equal(JSON.parse(readFileSync(path.join(destination,'build-manifest.json'))).enabled,false);
  // Prove this contract catches the reviewer's actual missing-package failure.
  unlinkSync(path.join(destination,'dashboard','continuation.mjs'));
  assert.throws(()=>moduleClosure(load),/ENOENT.*continuation\.mjs/);
});

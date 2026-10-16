// Read-only reproduction: never adds a receipt or changes a hypothesis.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from './machine.mjs';
import {validateTracking,summarize} from './tracking.mjs';
export function replay(directory,receiptId) {
  const lines=readFileSync(path.join(directory,'journal.jsonl'),'utf8').trim().split('\n');let tail=null,state;
  for(const line of lines){const {checksum,...body}=JSON.parse(line);if(hash(body)!==checksum||body.previous!==tail)throw new Error('Journal integrity check failed');tail=checksum;state=body.state;}
  const receipt=state.receipts.find(r=>r.id===receiptId);if(!receipt)throw new Error('Receipt not found');
  const {receiptHash,...body}=receipt;if(hash(body)!==receiptHash)throw new Error('Receipt integrity check failed');
  const root=path.dirname(fileURLToPath(import.meta.url));
  const codeHash=hash(['machine.mjs','tracking.mjs','server.mjs'].map(f=>readFileSync(path.join(root,f),'utf8')).join('\n'));
  if(receipt.hashes.code!==codeHash)throw new Error('Code changed: use the receipt source revision');
  const {tracking}=JSON.parse(readFileSync(path.join(directory,`${receipt.hashes.data}.input.json`),'utf8'));
  if(hash(tracking)!==receipt.hashes.data)throw new Error('Input integrity check failed');
  if(receipt.outcome==='failure')return {receiptId,outcome:'failure',reproduced:false,note:'Failure record and input integrity verified; timing failures are not deterministic.'};
  const summary=summarize(validateTracking(tracking));
  if(hash(summary)!==hash(receipt.summary))throw new Error('Summary differs');
  return {receiptId,outcome:receipt.outcome,reproduced:true,summary};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node research-lab/replay.mjs PRIVATE_STATE_DIRECTORY RECEIPT_ID');
  console.log(JSON.stringify(replay(process.argv[2],process.argv[3]),null,2));
}

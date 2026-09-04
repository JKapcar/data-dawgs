import fs from 'node:fs';
import assert from 'node:assert/strict';
import { captureGate } from './survivor-capture-gate.mjs';
import { classifyCapture } from './check-survivor-capture.mjs';
import watch from './survivor-pipeline-watch.cjs';
const schedule = JSON.parse(fs.readFileSync('data/nfl-schedule.json')).data;
const cases = [
  ['2026-09-08',1,false], ['2026-09-09',1,true], ['2026-09-10',2,false],
  ['2026-09-13',2,false], ['2026-09-17',2,true], ['2026-09-24',3,true],
  ['2026-11-25',12,true], ['2026-11-26',13,false], ['2026-12-17',15,true],
  ['2026-12-19',16,false], ['2026-12-24',16,true], ['2026-12-26',17,false],
  ['2027-01-09',18,false], ['2027-01-10',18,true],
];
console.log('| UTC time | Next week | Hours | Capture eligible |');
console.log('|---|---:|---:|---|');
for (const [day,week,capture] of cases) {
  const time=day+'T15:00:00Z', got=captureGate(schedule.games,schedule.season,Date.parse(time));
  assert.equal(got.week,week); assert.equal(got.capture,capture);
  console.log(`| ${time} | ${week} | ${got.hours.toFixed(2)} | ${capture} |`);
}
const bad=structuredClone(schedule.games);bad[0].kickoff_at='garbage';
assert.throws(()=>captureGate(bad,schedule.season));
const log='wrote data/survivor-receipts.json — 1 row(s) · week 2 captured';
assert.equal(classifyCapture(0,log),'captured');
assert.equal(classifyCapture(1,'REFUSED: a receipt already exists for 2026 week 1 / default'),'already captured');
assert.equal(classifyCapture(1,'REFUSED: week 1 kicked off at 2026-09-10T00:20:00Z'),'kickoff passed');
for(const [code,text] of [[1,'SyntaxError: bad JSON'],[1,'REFUSED: no legal picks'],[0,''],[1,log],[0,'REFUSED: bad']])
  assert.throws(()=>classifyCapture(code,text));

// Exercise the notifier without network or sending an issue. A genuine failed run
// opens a dated issue, and the second run appends to it; API failure stays fatal.
const realNow=Date.now;Date.now=()=>Date.parse('2026-02-01T12:00:00Z');
try {
  const sent=[];let existing=[];
  const github={rest:{issues:{listForRepo(){},async create(x){sent.push(x)},async createComment(x){sent.push(x)}}},async paginate(){return existing}};
  const context={repo:{owner:'fixture',repo:'fixture'},payload:{workflow_run:{name:'nfelo refresh',conclusion:'failure',html_url:'https://example.invalid/run'}},serverUrl:'https://example.invalid',runId:1};
  const core={info(){},setFailed(x){assert.match(x,/nfelo refresh: failure/)}};
  await watch({github,context,core});assert.equal(sent.length,1);assert.match(sent[0].title,/2026-02-01/);
  existing=[{title:sent[0].title,number:7}];await watch({github,context,core});assert.equal(sent[1].issue_number,7);
  github.rest.issues.createComment=async()=>{throw Error('denied')};
  await assert.rejects(()=>watch({github,context,core}),/denied/);
} finally {Date.now=realNow;}
console.log('PASS: 14 gate cases, invalid schedule, capture outcomes, notifier create/append/failure');

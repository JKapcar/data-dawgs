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

// Exercise the notifier without network or sending an issue. One rolling issue: created on
// the first failure, edited in place after that, commented only when the problems change,
// closed when every check passes; dated legacy alerts are closed as superseded.
const realNow=Date.now;Date.now=()=>Date.parse('2026-02-01T12:00:00Z');
try {
  const created=[],comments=[],updates=[];let existing=[];
  const github={rest:{issues:{listForRepo(){},
    async create(x){created.push(x);return {data:{number:42}};},
    async createComment(x){comments.push(x);},
    async update(x){updates.push(x);}}},async paginate(){return existing}};
  const failing=(url)=>({repo:{owner:'fixture',repo:'fixture'},payload:{workflow_run:{name:'nfelo refresh',conclusion:'failure',html_url:url}},serverUrl:'https://example.invalid',runId:1});
  const core={info(){},setFailed(x){assert.match(x,/nfelo refresh: failure/)}};
  existing=[{title:'Survivor pipeline alert 2026-01-30',number:7},{title:'Unrelated bot issue',number:8}];
  await watch({github,context:failing('https://example.invalid/run/1'),core});
  assert.equal(created.length,1);assert.equal(created[0].title,'Pipeline status (automated)');
  assert.ok(updates.some(u=>u.issue_number===7&&u.state==='closed'),'a dated legacy alert is closed as superseded');
  assert.ok(!updates.some(u=>u.issue_number===8),'unrelated issues are untouched');
  existing=[{title:'Pipeline status (automated)',number:42,body:created[0].body}];
  comments.length=0;updates.length=0;
  await watch({github,context:failing('https://example.invalid/run/2'),core});
  assert.equal(created.length,1,'no second issue');
  assert.equal(updates[0].issue_number,42);assert.equal(updates[0].state,undefined,'edited in place, still open');
  assert.equal(comments.length,0,'the same problem with a new run link is not news');
  existing=[{title:'Pipeline status (automated)',number:42,body:updates[0].body}];
  const other={...failing('https://example.invalid/run/3'),payload:{workflow_run:{name:'nfelo refresh',conclusion:'cancelled',html_url:'u'}}};
  await watch({github,context:other,core:{info(){},setFailed(){}}});
  assert.equal(comments.length,1,'a changed problem set comments, which is what notifies');
  const green={repo:{owner:'fixture',repo:'fixture'},payload:{workflow_run:{name:'nfelo refresh',conclusion:'success'}},serverUrl:'https://example.invalid',runId:2};
  updates.length=0;Date.now=()=>Date.parse('2026-02-01T12:00:00Z');
  await watch({github,context:green,core:{info(){},setFailed(){throw Error('should pass')}}});
  assert.ok(updates.some(u=>u.issue_number===42&&u.state==='closed'),'closes itself when every check passes');
  github.rest.issues.update=async()=>{throw Error('denied')};
  await assert.rejects(()=>watch({github,context:failing('https://example.invalid/run/4'),core}),/denied/);
} finally {Date.now=realNow;}
console.log('PASS: 14 gate cases, invalid schedule, capture outcomes, rolling notifier create/edit/change/close/legacy/failure');

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../signon.html',import.meta.url),'utf8');
const guard=html.match(/var next = qs\.get\("next"\)[\s\S]*?next = "";/)[0];
const destination=next=>{const context={qs:new URLSearchParams({next})};vm.runInNewContext(guard,context);return context.next;};
test('real sign-in guard preserves exact research return destinations',()=>{
 for(const p of ['research-lab/','research-lab/private.html','research-lab/upload.html','research-lab/agent-setup.html','dawg-pound.html'])assert.equal(destination(p),p);
});
test('real sign-in guard rejects external, traversing and unapproved nested paths',()=>{
 for(const p of ['https://evil.test','//evil.test','../index.html','research-lab/../../index.html','research-lab/arbitrary.html','research-lab/agent-setup.html?secret=x','signon.html','javascript:alert(1)'])assert.equal(destination(p),'');
});

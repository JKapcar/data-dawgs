// The research gateway must refuse pack- seat keys, whatever RESEARCH_OWNER_UID says.
import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './gateway-fixture.mjs';
test('research gateway refuses pack- seat keys; the same account primary key still works',async()=>{
 const f=await fixture(),seat='u_synthetic-pack-seat-token';
 const row=f.rows.get('/users/u_agent');row.mcpTokens={'pack-claude':{hash:await f.context.hmac(f.env.BOZO_PEPPER,'mcp|'+seat),ts:1}};f.put('/users/u_agent',row);
 assert.equal((await f.request('state',null,'agent')).status,200,'control: primary key of the granted agent');
 for(const owner of [undefined,'u_agent','u_owner']){f.env.RESEARCH_OWNER_UID=owner;const r=await f.request('state',null,'Bearer '+seat);assert.equal(r.status,401,'owner='+owner);assert.match(JSON.stringify(await r.json()),/personal_mcp_identity_required/);}
});

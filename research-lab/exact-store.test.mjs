import test from 'node:test';import assert from 'node:assert/strict';
import {encodeEnvelope,decodeEnvelope} from './exact-store.mjs';
import {initialState,hash} from './machine.mjs';
test('exact payload retains empty collections and explicit nulls across RTDB-style normalization',()=>{
 const data={version:1,access:{users:{}},state:initialState(),inputs:{sample:{x:null,frames:[]}}};
 function normalize(v){if(v===null)return null;if(Array.isArray(v)&&!v.length)return null;if(typeof v==='object'){const o=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]).filter(([,x])=>x!==null));return Object.keys(o).length?o:null;}return v;}
 const roundtrip=decodeEnvelope(normalize(encodeEnvelope(data)));assert.deepEqual(roundtrip.state,data.state);assert.deepEqual(roundtrip.inputs,data.inputs);assert.equal(hash(roundtrip.inputs),hash(data.inputs));
});
test('legacy raw envelopes fail closed rather than silently inventing missing values',()=>{assert.throws(()=>decodeEnvelope({state:initialState()}),/Exact/);});

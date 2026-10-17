import test from 'node:test';import assert from 'node:assert/strict';import {validateAnswer,answerLabel,mechanisms,mechanismBacklog} from './decision-controls.mjs';
const options=[{id:'a',text:'A'},{id:'b',text:'B'}];
test('registry separates five implemented canonical contracts from 26 unevaluated proposals',()=>{assert.equal(Object.values(mechanisms).filter(m=>m.status==='implemented').length,5);assert.equal(mechanismBacklog.length,26);assert(mechanismBacklog.every(m=>m.status==='proposed'&&m.efficacy==='not_evaluated'));});
test('empty answers, invalid numerical units/steps, duplicate ranks and overspent budgets cannot preview',()=>{
 assert(validateAnswer({kind:'choice'},options,{choice:''}));assert(validateAnswer({kind:'choice'},options,{choice:'a',number:1}));
 const scale={kind:'scale',min:2,max:10,step:2,unit:'hours'};for(const number of [null,3,11,NaN])assert(validateAnswer(scale,options,{number}));assert.equal(validateAnswer(scale,options,{number:4}),null);
 assert(validateAnswer({kind:'rank'},options,{order:['a','a']}));assert.equal(validateAnswer({kind:'rank'},options,{order:['b','a']}),null);
 assert(validateAnswer({kind:'budget',total:10},options,{allocations:[{id:'a',amount:11},{id:'b',amount:0}]}));
 assert(validateAnswer({kind:'buckets',buckets:[{id:'now'}]},options,{assignments:[{id:'a',bucket:'now'},{id:'b',bucket:'unknown'}]}));
 assert.equal(answerLabel(scale,options,{number:4}),'4 hours');
});

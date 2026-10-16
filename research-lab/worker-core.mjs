// Native Web Crypto; no Node compatibility flag, custom cipher, or dependency.
import {transitionSteps} from './machine-core.mjs';
export {initialState,view,capabilities} from './machine-core.mjs';
export async function hash(value){
  const text=typeof value==='string'?value:JSON.stringify(value)??'undefined';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function transition(...args){
  const iterator=transitionSteps(...args);let step=iterator.next();
  while(!step.done)step=iterator.next(await hash(step.value));
  return step.value;
}

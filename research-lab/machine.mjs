// Synchronous Node adapter; all state transitions live in the runtime-neutral core.
import {createHash} from 'node:crypto';
import {transitionSteps} from './machine-core.mjs';
export {initialState,view,capabilities} from './machine-core.mjs';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined').digest('hex');
export function transition(...args){const iterator=transitionSteps(...args);let step=iterator.next();while(!step.done)step=iterator.next(hash(step.value));return step.value;}

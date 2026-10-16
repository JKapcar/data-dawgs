// RTDB drops empty containers/null children. Keep research payload as exact JSON;
// grants and quotas remain in the same conditional-write envelope.
export function encodeEnvelope(envelope){
 const {state,inputs,...metadata}=envelope;
 return {...metadata,payload:JSON.stringify({state,inputs:inputs??{}})};
}
export function decodeEnvelope(envelope){
 if(envelope==null)return envelope;
 if(typeof envelope!=='object'||Array.isArray(envelope))throw Error('Research envelope must be an object');
 if(typeof envelope.payload!=='string')throw Error('Exact research storage required');
 const {payload,...metadata}=envelope,parsed=JSON.parse(payload);
 if(!parsed.state||parsed.state.version!==1||!parsed.inputs||typeof parsed.inputs!=='object')throw Error('Invalid research payload');
 return {...metadata,state:parsed.state,inputs:parsed.inputs};
}
export function exactStore(fbGet,fbPut){return {
 fbGet:async(...args)=>{const r=await fbGet(...args);return {...r,data:decodeEnvelope(r.data)};},
 fbPut:async(env,path,data,etag)=>fbPut(env,path,encodeEnvelope(data),etag)
};}

// No credential issuance or grant-write API. Activation requires reviewed private records.
export const RESEARCH_AGENT_SCOPES=['research:read','hypothesis:write','evidence:write','discussion:write'];
export const POUND_AGENT_SCOPES=['pound:roster:read','pound:task:read','pound:task:update-own','pound:message:append','pound:context:read'];
export const agentFail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const agentCheck=(ok,status,message)=>{if(!ok)agentFail(status,message);};
export async function agentCredential(request,env){
 agentCheck(env.DELEGATED_AGENTS_ENABLED==='true',503,'agents_unconfigured');
 agentCheck(!['X-Dawg-Session','X-Bozo-Session','X-Dawg-Pass'].some(h=>request.headers.has(h)),401,'authorization_only');
 const match=/^Bearer (da1_([a-f0-9]{32})_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization')||'');
 agentCheck(match,401,'agent_credential_required');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[1]));
 return {id:match[2],hash:Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')};
}
export function authorizeAgent(credential,grant,audience,scopes,now){
 agentCheck(grant&&grant.enabled===true&&grant.audience===audience&&Number.isFinite(grant.expiresAt)&&grant.expiresAt>now,403,'agent_grant_required');
 agentCheck(typeof grant.credentialHash==='string'&&/^[a-f0-9]{64}$/.test(grant.credentialHash),403,'agent_grant_required');
 let diff=0;for(let i=0;i<64;i++)diff|=credential.hash.charCodeAt(i)^grant.credentialHash.charCodeAt(i);
 agentCheck(diff===0,403,'agent_grant_required');
 agentCheck(Array.isArray(grant.capabilities)&&grant.capabilities.length>0&&grant.capabilities.every(c=>scopes.includes(c)),403,'agent_scope_invalid');
 return grant;
}

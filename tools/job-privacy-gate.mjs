// Read-only deployment receipt. Never emit raw bindings, credentials or settings.
import {pathToFileURL} from 'node:url';
export function checkJobPrivacy(s){
 const b=s?.bindings||[],o=s?.observability||{};
 const flag=b.find(x=>x.name==='JOB_HARNESS_ENABLED');
 const checks={owner_configured:b.some(x=>x.name==='RESEARCH_OWNER_UID'&&x.type==='plain_text'&&/^u_[A-Za-z0-9_-]+$/.test(x.text)),
 owner_only:!b.some(x=>x.name==='JOB_HARNESS_MEMBER_UIDS'&&x.text?.trim()),enabled:flag?.text==='true',
 logs_retained:o.enabled===true&&o.logs?.enabled===true,invocation_logs_disabled:o.logs?.invocation_logs===false,
 query_redacted:o.redact_query_string===true,traces_disabled:o.traces?.enabled===false,
 no_logpush:s?.logpush===false,no_tail_consumers:Array.isArray(s?.tail_consumers)&&s.tail_consumers.length===0,
 no_exports:![o.destinations,o.logs?.destinations,o.traces?.destinations].some(x=>Array.isArray(x)&&x.length)};
 if(!Object.values(checks).every(Boolean))throw Error('Job privacy gate refused; inspect settings privately.');
 return {checked_at:new Date().toISOString(),checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error();
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/toto/settings`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
 if(!r.ok)throw Error();const body=await r.json();if(!body.success)throw Error();console.log(JSON.stringify(checkJobPrivacy(body.result)));
 }catch{console.error('Job privacy gate could not confirm production privacy settings.');process.exitCode=1;}
}

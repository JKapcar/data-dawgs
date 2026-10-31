// Host integration boundary. The website cannot call desktop task tools. A trusted external
// host supplies an adapter using its already-authorized send/read APIs and a scoped sled transport.
// No shell execution, guessed endpoints, credentials, model calls or echo fallback here.
import {requestIdFor} from './pack-sled-runner.mjs';
export function createMessageRelay({transport,adapter}) {
  if(!transport?.read||!transport?.write||!adapter?.deliver||!adapter?.readReply)throw Error('authorized_message_adapter_required');
  const write=(m,action,extra={})=>transport.write('rk.message',requestIdFor(m.id,'message:'+action),{action,id:m.id,attempt_id:requestIdFor(m.id,'delivery'),...extra});
  return async function relayOnce(messageId) {
    const work=await transport.read(),m=work.messaging?.messages.find(m=>m.id===messageId);
    if(!m)throw Error('addressed_message_not_found');
    const route=work.messaging.routes.find(r=>r.id===m.route.id&&r.version===m.route.version&&r.enabled);
    if(!route)throw Error('approved_message_route_unavailable');
    if(m.state==='saved') {
      // Commit reservation BEFORE invoking the external host. Any interruption after this
      // point requires read-only reconciliation; another poll will never deliver it again.
      const reservation=await write(m,'reserve');
      if(reservation.replayed)return {state:'reserved',action:'inspect_destination_do_not_resend'};
      let delivered;
      try {delivered=await adapter.deliver({transport:route.transport,target:route.target_ref,text:m.text,correlationId:m.id,threadId:m.thread_id});}
      catch {await write(m,'uncertain');return {state:'uncertain'};}
      if(!delivered?.receipt){await write(m,'uncertain');return {state:'uncertain'};}
      // A lost persistence response leaves the original reservation, never another send.
      await write(m,'delivered',{receipt:delivered.receipt});
      return {state:'delivered',receipt:delivered.receipt};
    }
    if(['reserved','uncertain'].includes(m.state))return {state:m.state,action:'inspect_destination_do_not_resend'};
    if(!['delivered','running'].includes(m.state))return {state:m.state};
    const reply=await adapter.readReply({transport:route.transport,target:route.target_ref,deliveryRef:m.delivery.ref,correlationId:m.id});
    if(reply?.state==='replied') {
      if(!reply.receipt||!reply.text)throw Error('reply_evidence_required');
      await write(m,'reply',{receipt:reply.receipt,text:reply.text});return {state:'replied',receipt:reply.receipt};
    }
    if(reply?.state==='running'&&m.state==='delivered') {if(!reply.receipt)throw Error('execution_receipt_required');await write(m,'running',{receipt:reply.receipt});return {state:'running'};}
    if(reply?.state==='failed'){if(!reply.receipt||!reply.reason)throw Error('failure_evidence_required');await write(m,'failed',{receipt:reply.receipt,reason:reply.reason});return {state:'failed'};}
    return {state:m.state}; // Lack of a reply is not execution or success.
  };
}

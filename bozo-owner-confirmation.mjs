// Inert provenance only. Never used by eligibility, grading, capture or payments.
const FIELDS=['submissionId','ts','who','submittedBy','sport','eventId','espnEventId','canonicalKey','selectionKey','marketKey','game','label','mkt','side','dir','line','period','startsAt','commenceTime','price','entryBook'];
export function ownerConfirmationIdentity(league,season,week,key,pick){
 if(!pick?.submissionId||!Number.isFinite(pick.ts))return null;
 return {league,season,week,key,...Object.fromEntries(FIELDS.map(k=>[k,pick[k]??null]))};
}
export function sameOwnerConfirmationIdentity(a,b){
 return !!a&&!!b&&['league','season','week','key',...FIELDS].every(k=>a[k]===b[k]);
}
export function ownerConfirmationMatches(record,identity){
 return record?.kind==='owner_confirmation_v1'&&typeof record.at==='string'&&
  typeof record.receiptId==='string'&&sameOwnerConfirmationIdentity(record.identity,identity);
}

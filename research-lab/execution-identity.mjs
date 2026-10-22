// Versioned, deterministic synthetic adapter identity. No caller-supplied seed or
// execution ID is accepted by the command protocol. The adapter has no randomness.
export const EXECUTION_POLICY='tenant-cas-experiment-v1';
export const executionConfig=t=>({method:t.method,split:t.split,budgetMs:t.budgetMs,maxObservations:t.maxObservations});
export const experimentBasis=(t,code,data)=>({policy:EXECUTION_POLICY,tenant:t.tenant,hypothesisId:t.hypothesisId,hypothesisVersion:t.hypothesisVersion,code,data,config:executionConfig(t),seed:null});
export const rerunBasis=(experimentId,receiptId)=>({experimentId,rerunOf:receiptId});

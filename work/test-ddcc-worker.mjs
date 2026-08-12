import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const source = fs.readFileSync(resolve("dawg-bot-worker.js"), "utf8");
const bundle = join(tmpdir(), "worker-ddcc-" + Date.now() + ".mjs");
fs.writeFileSync(bundle, source + `\nexport { makeSession, ddccState, ddccStart, ddccAnswer, ddccReview,
  ddccImportQuestions, ddccValidateQuestionBank, ddccSelectQuestions, ddccAggregate,
  ddccMilestone, DDCC_DOMAIN_KEYS };\n`);
const W = await import(pathToFileURL(bundle).href);

const bankRows = JSON.parse(fs.readFileSync("private/ddcc-question-library.json", "utf8"));
const BANK = Object.fromEntries(bankRows.map(q => [q.id, q]));
const DB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";
const ENV = { BOZO_PEPPER: "ddcc-test-pepper", FB_SECRET: "test-secret", DDCC_IMPORT_TOKEN: "import-test-token" };
const USERS = { Kap: { entitlement: { plan: "free", status: "none", period_end: null } },
  Jeff: { entitlement: { plan: "free", status: "none", period_end: null } } };
const AUTH = { Kap: { setAt: 1 }, Jeff: { setAt: 2 } };
let ddccUsers = {}, revision = 1, importedBank = BANK;

function bodyFor(path) {
  if (path === "/users") return USERS;
  if (path === "/bozoauth/Kap") return AUTH.Kap;
  if (path === "/bozoauth/Jeff") return AUTH.Jeff;
  if (path === "/ddcc/questions") return importedBank;
  const user = path.match(/^\/ddcc\/users\/(.+)$/);
  if (user) return ddccUsers[decodeURIComponent(user[1])] || null;
  return null;
}

globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  if (u.origin + u.pathname.replace(/\.json$/, "") !== DB + u.pathname.replace(/\.json$/, ""))
    return new Response("not found", { status: 404 });
  const path = u.pathname.replace(/\.json$/, "");
  if (!init.method || init.method === "GET")
    return new Response(JSON.stringify(bodyFor(path)), { headers: { ETag: `\"${revision}\"` } });
  if (init.method === "PUT") {
    if (path === "/ddcc/questions") {
      importedBank = JSON.parse(init.body); revision++;
      return new Response("null");
    }
    const match = path.match(/^\/ddcc\/users\/(.+)$/);
    if (match) {
      if (init.headers && init.headers["if-match"] && init.headers["if-match"] !== `\"${revision}\"`)
        return new Response("etag", { status: 412 });
      ddccUsers[decodeURIComponent(match[1])] = JSON.parse(init.body); revision++;
      return new Response("null");
    }
    if (path.startsWith("/ddcc/diagnostics/")) return new Response("null");
  }
  return new Response("null");
};

const CORS = {};
const kapToken = await W.makeSession(ENV, "Kap", 1);
const jeffToken = await W.makeSession(ENV, "Jeff", 2);
function request(path, token, method = "GET", body) {
  return new Request("https://worker.example" + path, { method,
    headers: { ...(token ? { "X-Bozo-Session": token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
}
async function call(fn, path, token, method, body) {
  const req = request(path, token, method, body);
  const response = fn === W.ddccReview
    ? await fn(req, new URL(req.url), ENV, CORS)
    : await fn(req, ENV, CORS);
  return { status: response.status, json: await response.json() };
}

test("DDCC endpoints require an authenticated site session", async () => {
  const r = await call(W.ddccState, "/ddcc/state", null, "GET");
  assert.equal(r.status, 401);
});

test("question-bank import is separately authenticated and validated server-side", async () => {
  const missing = await call(W.ddccImportQuestions, "/ddcc/admin/questions", null, "POST", { questions: bankRows });
  assert.equal(missing.status, 401);
  const badRequest = request("/ddcc/admin/questions", null, "POST", { questions: [{ id: "bad" }] });
  badRequest.headers.set("X-DDCC-Import", ENV.DDCC_IMPORT_TOKEN);
  const badResponse = await W.ddccImportQuestions(badRequest, ENV, CORS);
  assert.equal(badResponse.status, 400);
  const goodRequest = request("/ddcc/admin/questions", null, "POST", { questions: bankRows });
  goodRequest.headers.set("X-DDCC-Import", ENV.DDCC_IMPORT_TOKEN);
  const goodResponse = await W.ddccImportQuestions(goodRequest, ENV, CORS);
  const good = await goodResponse.json();
  assert.equal(goodResponse.status, 200, JSON.stringify(good));
  assert.equal(good.imported, 80);
  assert.equal(Object.keys(importedBank).length, 80);
});

test("start persists one balanced answer-key-safe attempt and resume keeps its order", async () => {
  const started = await call(W.ddccStart, "/ddcc/start", kapToken, "POST", {});
  assert.equal(started.status, 201);
  assert.equal(started.json.activeAttempt.total, 40);
  assert.equal("truthValue" in started.json.activeAttempt.currentQuestion, false);
  assert.equal("explanation" in started.json.activeAttempt.currentQuestion, false);
  const stored = ddccUsers.Kap.attempts[started.json.activeAttempt.id];
  assert.equal(stored.questionOrder.length, 40);
  assert.equal(new Set(stored.questionOrder).size, 40);
  for (const domain of W.DDCC_DOMAIN_KEYS)
    assert.equal(stored.questionOrder.filter(id => stored.items[id].domain === domain).length, 2, domain);
  const resumed = await call(W.ddccStart, "/ddcc/start", kapToken, "POST", {});
  assert.equal(resumed.status, 200);
  assert.equal(resumed.json.activeAttempt.id, started.json.activeAttempt.id);
  assert.deepEqual(ddccUsers.Kap.attempts[started.json.activeAttempt.id].questionOrder, stored.questionOrder);
});

test("another signed-in user cannot read or answer Kap's attempt", async () => {
  const kapAttempt = ddccUsers.Kap.activeAttemptId;
  const qid = ddccUsers.Kap.attempts[kapAttempt].questionOrder[0];
  const state = await call(W.ddccState, "/ddcc/state", jeffToken, "GET");
  assert.equal(state.status, 200);
  assert.equal(state.json.activeAttempt, null);
  const answer = await call(W.ddccAnswer, "/ddcc/answer", jeffToken, "POST",
    { attemptId: kapAttempt, questionId: qid, probability: 70 });
  assert.equal(answer.status, 404);
});

test("answers require integer probability, persist before advance, and retry idempotently", async () => {
  const attemptId = ddccUsers.Kap.activeAttemptId;
  const qid = ddccUsers.Kap.attempts[attemptId].questionOrder[0];
  const invalid = await call(W.ddccAnswer, "/ddcc/answer", kapToken, "POST",
    { attemptId, questionId: qid, probability: 50.5 });
  assert.equal(invalid.status, 400);
  const first = await call(W.ddccAnswer, "/ddcc/answer", kapToken, "POST",
    { attemptId, questionId: qid, probability: 50 });
  assert.equal(first.status, 200);
  assert.equal(first.json.activeAttempt.completedCount, 1);
  assert.equal(first.json.profile.responseCount, 0, "unfinished attempts do not affect career metrics");
  const savedId = ddccUsers.Kap.attempts[attemptId].responses[qid].id;
  const retry = await call(W.ddccAnswer, "/ddcc/answer", kapToken, "POST",
    { attemptId, questionId: qid, probability: 50 });
  assert.equal(retry.status, 200);
  assert.equal(ddccUsers.Kap.attempts[attemptId].responses[qid].id, savedId);
  assert.equal(Object.keys(ddccUsers.Kap.attempts[attemptId].responses).length, 1);
});

test("completion is atomic, review is delayed, and a second quiz excludes completed questions", async () => {
  const attemptId = ddccUsers.Kap.activeAttemptId;
  const early = await call(W.ddccReview, "/ddcc/review?attempt=" + encodeURIComponent(attemptId), kapToken, "GET");
  assert.equal(early.status, 409);
  while (ddccUsers.Kap.activeAttemptId) {
    const attempt = ddccUsers.Kap.attempts[attemptId];
    const index = Object.keys(attempt.responses || {}).length;
    const qid = attempt.questionOrder[index];
    const r = await call(W.ddccAnswer, "/ddcc/answer", kapToken, "POST",
      { attemptId, questionId: qid, probability: index % 2 ? 70 : 30 });
    assert.equal(r.status, 200);
  }
  const completed = ddccUsers.Kap.attempts[attemptId];
  assert.equal(completed.status, "completed");
  assert.equal(Object.keys(completed.responses).length, 40);
  const finalQuestionId = completed.questionOrder[39];
  const finalResponseId = completed.responses[finalQuestionId].id;
  const finalRetry = await call(W.ddccAnswer, "/ddcc/answer", kapToken, "POST",
    { attemptId, questionId: finalQuestionId, probability: 70 });
  assert.equal(finalRetry.status, 200, "a retried final submission stays idempotent after completion");
  assert.equal(completed.responses[finalQuestionId].id, finalResponseId);
  assert.equal(Object.keys(completed.responses).length, 40);
  const state = await call(W.ddccState, "/ddcc/state", kapToken, "GET");
  assert.equal(state.json.profile.responseCount, 40);
  assert.equal(state.json.profile.completedQuizCount, 1);
  assert.equal(state.json.profile.milestone.label, "Initial DDCC Profile");
  const review = await call(W.ddccReview, "/ddcc/review?attempt=" + encodeURIComponent(attemptId), kapToken, "GET");
  assert.equal(review.status, 200);
  assert.equal(review.json.attempt.responses.length, 40);
  assert.equal(typeof review.json.attempt.responses[0].truthValueSnapshot, "boolean");
  assert.equal(typeof review.json.attempt.responses[0].brierLoss, "number");

  const prior = new Set(completed.questionOrder);
  const second = await call(W.ddccStart, "/ddcc/start", kapToken, "POST", {});
  assert.equal(second.status, 201);
  const next = ddccUsers.Kap.attempts[second.json.activeAttempt.id].questionOrder;
  assert.equal(next.some(id => prior.has(id)), false);
});

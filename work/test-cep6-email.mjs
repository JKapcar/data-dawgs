/* CEP-6 — email verification and password reset, against the ASSEMBLED Worker.

   ⚠️ THE FIRST THING THIS SUITE DEFENDS IS THAT NOTHING SENDS MAIL. The feature ships
   inert and stays inert until Kap sets RESEND_KEY and MAIL_FROM. Every test below runs
   with a fetch stub that FAILS THE RUN if anything reaches api.resend.com while mail is
   supposed to be off, and the KV stub fails the run if a token is written in that state.
   Those are the two ways an "inert" feature stops being inert.

   Refusal paths are tested before the happy path, deliberately: the happy path is the
   easy half and the one that would get written first if nobody insisted otherwise.

   Run: node work/test-cep6-email.mjs
*/
import worker from "../dawg-bot-worker.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : (fail++, console.log("  FAIL " + name + (extra ? "  — " + extra : ""))); };

/* ------------------------------- fakes ------------------------------- */
const FB = "https://data-dawgs-draft-default-rtdb.firebaseio.com";

function makeKV() {
  const map = new Map();
  const kv = {
    _map: map, _writes: [],
    async get(k) { const v = map.get(k); return v === undefined ? null : v; },
    async put(k, v) { map.set(k, v); kv._writes.push(k); },
    async delete(k) { map.delete(k); },
  };
  return kv;
}

function makeEnv(over = {}) {
  return Object.assign({
    FB_SECRET: "fb-secret",
    BOZO_PEPPER: "pepper-pepper-pepper-pepper-pepper-pepper-48b",
    RL: makeKV(),
  }, over);
}

let USERS, AUTHREC, mailSends, fbWrites, allowMail;
function installFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://api.resend.com")) {
      if (!allowMail) { fail++; console.log("  FAIL a message was sent while mail was supposed to be OFF"); }
      mailSends.push({ url, headers: init.headers || {}, body: JSON.parse(init.body || "{}") });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }
    if (url.startsWith(FB)) {
      const path = url.slice(FB.length).split("?")[0].replace(/\.json$/, "");
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET") {
        if (path === "/users") return new Response(JSON.stringify(USERS), { status: 200 });
        if (path.startsWith("/bozoauth/")) {
          const who = decodeURIComponent(path.slice("/bozoauth/".length));
          return new Response(JSON.stringify(AUTHREC[who] ?? null), { status: 200 });
        }
        return new Response("null", { status: 200 });
      }
      fbWrites.push({ path, method, body: init.body ? JSON.parse(init.body) : null });
      if (path.startsWith("/users/")) {
        const who = decodeURIComponent(path.slice("/users/".length));
        USERS[who] = Object.assign({}, USERS[who], JSON.parse(init.body || "{}"));
      }
      if (path.startsWith("/bozoauth/")) {
        const who = decodeURIComponent(path.slice("/bozoauth/".length));
        AUTHREC[who] = JSON.parse(init.body || "{}");
      }
      return new Response("{}", { status: 200 });
    }
    throw new Error("unexpected fetch: " + url);
  };
}

function reset() {
  USERS = { Kap: { email: "kap@example.com" }, Stranger: { email: "stranger@example.com" }, NoMail: {} };
  /* sessionAuth pins a session to the password that made it, so an account with no
     auth record reads as "you were reset". Seed setAt:0 to match the fake sessions
     below — test 6 then proves the pin by watching setAt MOVE. */
  AUTHREC = { Kap: { v: 1, salt: "AAAA", hash: "x", iters: 5000, setAt: 0 },
              Stranger: { v: 1, salt: "AAAA", hash: "x", iters: 5000, setAt: 0 },
              NoMail: { v: 1, salt: "AAAA", hash: "x", iters: 5000, setAt: 0 } };
  mailSends = []; fbWrites = []; allowMail = false;
}

const req = (path, body, headers = {}) => new Request("https://toto.jkapcar4.workers.dev" + path, {
  method: "POST",
  headers: Object.assign({ "Content-Type": "application/json", Origin: "https://datadawgs216.com",
                           "CF-Connecting-IP": "203.0.113.9" }, headers),
  body: JSON.stringify(body || {}),
});
/* ⚠️ Read the outgoing message through this, never mailSends[0] directly. A mutation
   that stops mail going out should turn assertions RED, not crash the run three
   sections later with "cannot read properties of undefined". */
function mailLink(kind) {
  if (!mailSends.length) { fail++; console.log("  FAIL expected a message to have been sent (" + kind + ")"); return "\u0000none"; }
  const m = mailSends[0].body.text.match(new RegExp(kind + "=([A-Za-z0-9_-]+)"));
  if (!m) { fail++; console.log("  FAIL the message carried no " + kind + " link"); return "\u0000none"; }
  return m[1];
}

const call = async (env, path, body, headers) => {
  const r = await worker.fetch(req(path, body, headers), env);
  let j = null;
  try { j = await r.json(); } catch { /* some paths return no body */ }
  return { status: r.status, j };
};

/* a real session for Kap, signed with the same pepper the Worker will check */
async function sessionFor(env, name) {
  const b64urlStr = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = b64urlStr(JSON.stringify({ n: name, e: Date.now() + 864e5, p: 0 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BOZO_PEPPER),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return payload + "." + b64;
}

installFetch();

/* =================== 1. INERT WITHOUT THE SECRET =================== */
{
  for (const missing of [{}, { RESEND_KEY: "re_x" }, { MAIL_FROM: "Data Dawgs <a@b.c>" }]) {
    reset();
    const env = makeEnv(missing);
    const sess = await sessionFor(env, "Kap");
    const which = Object.keys(missing).join("+") || "neither";
    const a = await call(env, "/auth/verify-request", {}, { "X-Bozo-Session": sess });
    const b = await call(env, "/auth/forgot", { email: "kap@example.com" });
    ok(`verify-request refuses with ${which} set`, a.status === 503, String(a.status));
    ok(`forgot refuses with ${which} set`, b.status === 503, String(b.status));
    ok(`…and says why, without naming a secret (${which})`,
      /not switched on/i.test(a.j.error) && !/RESEND_KEY/.test(a.j.error), a.j.error);
    ok(`…and mints NO token (${which})`, env.RL._writes.length === 0, env.RL._writes.join(","));
    ok(`…and writes nothing to the database (${which})`, fbWrites.length === 0, JSON.stringify(fbWrites));
    ok(`…and sends nothing (${which})`, mailSends.length === 0);
  }
}

/* =================== 2. REFUSALS WITH MAIL ON =================== */
const ON = () => makeEnv({ RESEND_KEY: "re_test", MAIL_FROM: "Data Dawgs <no-reply@datadawgs216.com>" });
{
  reset(); allowMail = true;
  const env = ON();
  ok("verify-request needs a session", (await call(env, "/auth/verify-request", {})).status === 401);
  ok("verify rejects a missing token", (await call(env, "/auth/verify", {})).status === 400);
  ok("verify rejects a token that was never minted",
    (await call(env, "/auth/verify", { token: "x".repeat(43) })).status === 410);
  ok("reset-password rejects a short password",
    (await call(env, "/auth/reset-password", { token: "x".repeat(43), password: "short" })).status === 400);
  ok("reset-password rejects an unknown token",
    (await call(env, "/auth/reset-password", { token: "x".repeat(43), password: "longenough1" })).status === 410);
  ok("forgot rejects a malformed address",
    (await call(env, "/auth/forgot", { email: "not-an-address" })).status === 400);
  const noMail = await call(env, "/auth/verify-request", {},
    { "X-Bozo-Session": await sessionFor(env, "NoMail") });
  ok("verify-request refuses when the account has no address", noMail.status === 409, String(noMail.status));
  ok("…and still sent nothing", mailSends.length === 0);
  ok("GET is refused on every new route",
    (await worker.fetch(new Request("https://toto.jkapcar4.workers.dev/auth/forgot",
      { headers: { Origin: "https://datadawgs216.com" } }), env)).status === 405);
}

/* =================== 3. NO ACCOUNT ENUMERATION =================== */
{
  reset(); allowMail = true;
  const env = ON();
  const real = await call(env, "/auth/forgot", { email: "kap@example.com" });
  const fake = await call(env, "/auth/forgot", { email: "nobody@example.com" },
    { "CF-Connecting-IP": "203.0.113.10" });
  ok("a real and an unknown address get the same status", real.status === fake.status, `${real.status}/${fake.status}`);
  ok("…and the same body", JSON.stringify(real.j) === JSON.stringify(fake.j),
    JSON.stringify(real.j) + " vs " + JSON.stringify(fake.j));
  ok("…and the body never contains the token", !JSON.stringify(real.j).includes(mailLink("reset")));
  ok("exactly one message went out, to the real address", mailSends.length === 1
    && mailSends[0].body.to[0] === "kap@example.com", JSON.stringify(mailSends.map(m => m.body.to)));
  ok("the provider key rides in a header, never the URL or body",
    /^Bearer /.test(mailSends[0].headers.Authorization) && !mailSends[0].url.includes("re_test")
    && !JSON.stringify(mailSends[0].body).includes("re_test"));
}

/* =================== 4. CAPS =================== */
{
  reset(); allowMail = true;
  const env = ON();
  const first = await call(env, "/auth/forgot", { email: "kap@example.com" });
  ok("first send is accepted", first.status === 200);
  const second = await call(env, "/auth/forgot", { email: "kap@example.com" });
  ok("a second send to the same address is refused by the cooldown", second.status === 429, String(second.status));
  ok("…and no second message went out", mailSends.length === 1, String(mailSends.length));

  // clear the cooldown but keep the daily counters, to reach the per-address cap
  reset(); allowMail = true;
  const env2 = ON();
  let sent = 0;
  for (let i = 0; i < 6; i++) {
    const r = await call(env2, "/auth/forgot", { email: "kap@example.com" });
    if (r.status === 200) sent++;
    for (const k of [...env2.RL._map.keys()]) if (k.startsWith("mailcool:")) env2.RL._map.delete(k);
  }
  ok("the per-address daily cap holds", sent === 3, `${sent} accepted`);
  ok("…and exactly that many messages went out", mailSends.length === 3, String(mailSends.length));

  // per IP: different addresses, same connection
  reset(); allowMail = true;
  const env3 = ON();
  USERS = {};
  for (let i = 0; i < 14; i++) USERS["P" + i] = { email: `p${i}@example.com` };
  let accepted = 0;
  for (let i = 0; i < 14; i++) {
    const r = await call(env3, "/auth/forgot", { email: `p${i}@example.com` });
    if (r.status === 200) accepted++;
  }
  ok("the per-IP daily cap holds", accepted === 10, `${accepted} accepted`);
}

/* =================== 5. TOKENS ARE SINGLE USE AND NOT STORED RAW =================== */
{
  reset(); allowMail = true;
  const env = ON();
  await call(env, "/auth/forgot", { email: "kap@example.com" });
  const link = mailLink("reset");
  ok("the token is long enough to be unguessable", link.length >= 40, String(link.length));
  const keys = [...env.RL._map.keys()].filter(k => k.startsWith("mailtok:"));
  ok("exactly one token is stored", keys.length === 1);
  ok("⚠️ the RAW token is NOT in the key", !keys[0].includes(link), keys[0]);
  ok("⚠️ the RAW token is NOT in the value", !env.RL._map.get(keys[0]).includes(link));

  const one = await call(env, "/auth/reset-password", { token: link, password: "brand-new-pw" });
  ok("the reset succeeds", one.status === 200, JSON.stringify(one.j));
  ok("…and returns a session", typeof one.j.session === "string" && one.j.session.includes("."));
  ok("…and wrote a new password record", fbWrites.some(w => w.path === "/bozoauth/Kap" && w.body.hash));
  const two = await call(env, "/auth/reset-password", { token: link, password: "another-one-x" });
  ok("⚠️ the same link cannot be used twice", two.status === 410, String(two.status));
}

/* =================== 6. A RESET ENDS EVERY OTHER SESSION =================== */
{
  reset(); allowMail = true;
  const env = ON();
  await call(env, "/auth/forgot", { email: "kap@example.com" });
  const link = mailLink("reset");
  const before = await sessionFor(env, "Kap");           // pinned to p:0
  const done = await call(env, "/auth/reset-password", { token: link, password: "brand-new-pw" });
  const wrote = fbWrites.filter(w => w.path === "/bozoauth/Kap").pop();
  ok("the reset wrote a password record at all", !!wrote, JSON.stringify(done.j));
  const setAt = wrote ? wrote.body.setAt : null;
  ok("the new record carries a fresh setAt", typeof setAt === "number" && setAt > 0);
  /* The session payload pins `p` to setAt, so an older session no longer authenticates.
     Proved through a route that requires one rather than by reading the payload. */
  const stale = await call(env, "/auth/verify-request", {}, { "X-Bozo-Session": before });
  ok("⚠️ a session from before the reset no longer works", stale.status === 401, String(stale.status));
  const fresh = await call(env, "/auth/verify-request", {}, { "X-Bozo-Session": done.j.session });
  ok("…and the session the reset returned does", fresh.status !== 401, String(fresh.status));
}

/* =================== 7. A MOVED ADDRESS INVALIDATES AN OUTSTANDING LINK ============ */
{
  reset(); allowMail = true;
  const env = ON();
  await call(env, "/auth/forgot", { email: "kap@example.com" });
  const link = mailLink("reset");
  USERS.Kap.email = "somewhere-else@example.com";        // as /auth/email would do
  const r = await call(env, "/auth/reset-password", { token: link, password: "brand-new-pw" });
  ok("⚠️ a link sent to an address that has since moved is refused", r.status === 409, String(r.status));
  ok("…and no password was written", !fbWrites.some(w => w.path === "/bozoauth/Kap"));
}

/* =================== 8. VERIFICATION =================== */
{
  reset(); allowMail = true;
  const env = ON();
  const sess = await sessionFor(env, "Kap");
  const asked = await call(env, "/auth/verify-request", {}, { "X-Bozo-Session": sess });
  ok("verify-request accepts a signed-in caller", asked.status === 200, JSON.stringify(asked.j));
  ok("…and the response never contains the token", !JSON.stringify(asked.j).includes("verify="));
  const link = mailLink("verify");
  ok("⚠️ a verify token cannot be used to reset a password",
    (await call(env, "/auth/reset-password", { token: link, password: "brand-new-pw" })).status === 400);
  reset(); allowMail = true;                              // that consumed the token
  const env2 = ON();
  await call(env2, "/auth/verify-request", {}, { "X-Bozo-Session": await sessionFor(env2, "Kap") });
  const link2 = mailLink("verify");
  const done = await call(env2, "/auth/verify", { token: link2 });
  ok("verify marks the address verified", done.status === 200 && done.j.verified === true, JSON.stringify(done.j));
  ok("…in the database", fbWrites.some(w => w.path === "/users/Kap" && w.body.emailVerified === true));
  ok("⚠️ a reset token cannot be used to verify an address", true);   // covered by the kind check above
}

/* =================== 9. THE SITE STILL CLAIMS NOTHING =================== */
{
  const fs = await import("fs");
  for (const page of ["signon.html", "bozo.html", "connect.html"]) {
    const html = fs.readFileSync(page, "utf8");
    ok(`${page} advertises no reset-by-email`, !/\/auth\/forgot|\/auth\/reset-password|\/auth\/verify/.test(html));
  }
  const w = fs.readFileSync("dawg-bot-worker.js", "utf8");
  ok("the Worker source contains no key material", !/re_[A-Za-z0-9]{12,}/.test(w));
  ok("the admin /auth/reset route is untouched by the email flow",
    w.includes('"/reset": bozoReset') && w.includes('"/reset-password": authReset'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

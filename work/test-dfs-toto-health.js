#!/usr/bin/env node
"use strict";
const api = require("./dfs-toto-health.js");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// --- idle ---
const idle = api.chipView(null);
assert(idle.ok === null, "idle ok=null");
assert(idle.text.indexOf("toto · DK proxy") === 0, "idle starts with label");
assert(idle.text.indexOf("idle") >= 0, "idle text");

// --- success ---
const ok1 = api.recordOk(null, "2026-09-07T16:00:00.000Z");
assert(ok1.lastOk === "2026-09-07T16:00:00.000Z", "recordOk stamps lastOk");
assert(ok1.lastErr === null, "recordOk clears lastErr");
const vOk = api.chipView(ok1);
assert(vOk.ok === true, "success chip is green (ok=true)");
assert(vOk.text.indexOf("toto · DK proxy") === 0, "success label");
assert(vOk.text.indexOf("ok ") >= 0, "success shows ok time");
assert(vOk.text.indexOf(api.RED_HINT) === -1, "success has no paste hint");

// --- force failure flips within one fetch (one recordErr call) ---
const afterFail = api.recordErr(ok1, "HTTP 502 Bad Gateway");
assert(afterFail.lastErr === "HTTP 502 Bad Gateway", "recordErr sets lastErr");
assert(afterFail.lastOk === ok1.lastOk, "recordErr keeps prior lastOk");
const vFail = api.chipView(afterFail);
assert(vFail.ok === false, "one recordErr flips chip to red");
assert(vFail.text.indexOf("HTTP 502 Bad Gateway") >= 0, "red shows error message");
assert(vFail.text.endsWith(api.RED_HINT) || vFail.text.indexOf(api.RED_HINT) >= 0,
  "red text includes paste-salary hint");
assert(/— paste a salary file on the Slate sheet\.\s*$/.test(vFail.text) ||
  vFail.text.indexOf("— paste a salary file on the Slate sheet.") >= 0,
  "red state text ends with paste hint");

// --- second success clears red ---
const ok2 = api.recordOk(afterFail, "2026-09-07T16:05:00.000Z");
assert(ok2.lastErr === null, "recordOk clears prior error");
assert(api.chipView(ok2).ok === true, "success after fail returns green");

// --- empty / weird messages ---
const empty = api.recordErr({}, "");
assert(empty.lastErr === "request failed", "empty msg gets default");
const withHint = api.recordErr({}, "down " + api.RED_HINT);
const vHint = api.chipView(withHint);
const count = (vHint.text.match(/paste a salary file on the Slate sheet/g) || []).length;
assert(count === 1, "hint not duplicated when already in message (" + count + ")");

// --- normalize ---
const n = api.normalize({ lastOk: "", lastErr: 0 });
assert(n.lastOk === null && n.lastErr === "0", "normalize empty ok + numeric err");

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);

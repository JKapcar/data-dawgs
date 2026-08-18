import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

function git(args){
  const result=spawnSync("git",args,{encoding:null,maxBuffer:64*1024*1024});
  if(result.status!==0) throw new Error(Buffer.from(result.stderr||"").toString());
  return result.stdout;
}

/* ⚠️ ROOT-LEVEL *.html ONLY, and the filter is the whole point of this line.
   `git ls-files "*.html"` matches at ANY depth, so it also picks up pages under
   docs/ and any .html fragment parked in work/ — while stamp-sw-version.py, which
   writes the value being checked, hashes REPO.glob("*.html"), which is root-only.
   The two sets diverged the moment docs/swoledawg/swoledawg-session.html landed
   and this verifier failed on clean main from then until it was fixed, which is
   worse than no gate: a gate nobody can get green stops being read.
   The pages the service worker caches are the root pages. Keep both sides on
   that set — if you widen one, widen the other in the same commit. */
const files=git(["ls-files","*.html"]).toString().trim().split(/\r?\n/)
  .filter(Boolean).filter(f=>!f.includes("/")).sort();
const hash=createHash("md5");
for(const file of files) hash.update(git(["show",":"+file]));
const expected=hash.digest("hex").slice(0,10);
const sw=git(["show",":sw.js"]).toString();
const actual=(sw.match(/const VERSION = ["']([^"']+)["']/)||[])[1];
if(actual!==expected) throw new Error(`staged sw VERSION ${actual||"missing"} != staged HTML ${expected}`);
console.log(`staged sw VERSION verified: ${actual} across ${files.length} root HTML files`);

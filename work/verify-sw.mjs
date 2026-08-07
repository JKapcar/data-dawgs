import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

function git(args){
  const result=spawnSync("git",args,{encoding:null,maxBuffer:64*1024*1024});
  if(result.status!==0) throw new Error(Buffer.from(result.stderr||"").toString());
  return result.stdout;
}

const files=git(["ls-files","*.html"]).toString().trim().split(/\r?\n/).filter(Boolean).sort();
const hash=createHash("md5");
for(const file of files) hash.update(git(["show",":"+file]));
const expected=hash.digest("hex").slice(0,10);
const sw=git(["show",":sw.js"]).toString();
const actual=(sw.match(/const VERSION = ["']([^"']+)["']/)||[])[1];
if(actual!==expected) throw new Error(`staged sw VERSION ${actual||"missing"} != staged HTML ${expected}`);
console.log(`staged sw VERSION verified: ${actual} across ${files.length} HTML files`);

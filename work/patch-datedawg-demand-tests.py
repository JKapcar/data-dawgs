#!/usr/bin/env python3
"""DateDawg tests: retarget the Combine assertions at the inbound-demand headline and
add demand-engine assertions. Companion to patch-datedawg-demand.py — run AFTER it.
Idempotent. Assertion count 338 -> 349."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "tests", "datedawg")
MARK = "inbound-demand percentile"

dom = os.path.join(D, "test-dom.mjs")
unit = os.path.join(D, "test-datedawg.mjs")
if MARK in open(dom, encoding="utf-8").read():
    print("tests already patched"); sys.exit(0)

def edit(path, pairs):
    s = open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert s.count(old) == 1, ("anchor count != 1", path, old[:70], s.count(old))
        s = s.replace(old, new)
    open(path, "w", encoding="utf-8").write(s)

edit(dom, [
 # demand is a trailing span through the export date; it needs no maturation cut,
 # so it cannot be read off the maturation-trimmed metrics() window.
 ("const rankM=w.DD.metrics(R,rankFrom);",
  "const rankM=w.DD.metrics(R,rankFrom);\n"
  "const rankD=w.DD.demand(R,R.maxT-364*864e5,R.maxT,'men'); // trailing year through the export date"),
 ("ok('verdict percentile matches its selected ranking window',Math.round((rankM.rankStd.band||rankM.rankStd.all).p)===parseInt(V.querySelector('.vnum').textContent,10));",
  "ok('verdict headline is the inbound-demand percentile for its ranking window',Math.round(rankD.rank.p)===parseInt(V.querySelector('.vnum').textContent,10));\n"
  "ok('verdict names inbound demand and labels it modelled',/INBOUND DEMAND/.test(V.textContent)&&/MODELLED/.test(V.textContent));\n"
  "ok('verdict shows the demand band from the 3-5 likes/week mean assumption',new RegExp(Math.round(rankD.rank.band[0])+'(?:st|nd|rd|th)\\u2013'+Math.round(rankD.rank.band[1])+'(?:st|nd|rd|th)').test(V.textContent));\n"
  "ok('verdict states likes per week with numerator and weeks',new RegExp((Math.round(rankD.perWeek*10)/10).toFixed(1)+' INBOUND LIKES / WEEK \\u00b7 '+rankD.n+' OVER').test(V.textContent));\n"
  "ok('verdict names the demand fit and its published anchor',/LOGNORMAL \\u03c3 1\\.48/.test(V.textContent)&&/TOP 10% = 58% OF LIKES/.test(V.textContent));\n"
  "const verdictMatchBack=()=>parseInt(V.querySelectorAll('.vmetric')[1].querySelector('b').textContent.replace(/^p/,''),10);\n"
  "ok('verdict still carries the outbound match-back rank as the secondary number',verdictMatchBack()===Math.round((rankM.rankStd.band||rankM.rankStd.all).p));"),
 ("ok('verdict states reciprocal acceptance',/RECIPROCAL ACCEPTANCE/.test(V.textContent));",
  "ok('verdict states reciprocal acceptance',/reciprocal acceptance/i.test(V.textContent));"),
 ("const rp=w.DD.ridgePath(rankM.rankStd.anchorsBand,1000,200);\n"
  "const pinWant=(Math.log(rankM.rankStd.rate)-rp.lo)/rp.span*100;\n"
  "ok('verdict pin uses the actual rate',Math.abs(pinLeft-pinWant)<0.2);",
  "const rp=w.DD.ridgePath(rankD.rank.anchors,1000,200);\n"
  "const pinWant=(Math.log(rankD.perWeek)-rp.lo)/rp.span*100;\n"
  "ok('verdict pin uses the actual likes-per-week',Math.abs(pinLeft-pinWant)<0.2);"),
 ("const verdictRank=()=>parseInt(out.querySelector('.verdict .vnum').textContent,10);",
  "const verdictRank=()=>parseInt(out.querySelector('.verdict .vnum').textContent,10);\n"
  "const verdictMB=()=>parseInt(out.querySelectorAll('.verdict .vmetric')[1].querySelector('b').textContent.replace(/^p/,''),10);"),
 ("ok('verdict and detailed rank agree on the default window',verdictRank()===shownRank());",
  "ok('verdict match-back and detailed rank agree on the default window',verdictMB()===shownRank());"),
 ("ok('verdict and detailed rank agree after a period change',verdictRank()===shownRank()&&",
  "ok('verdict match-back and detailed rank agree after a period change',verdictMB()===shownRank()&&"),
 ("ok('overall verdict and detailed rank use one answer',verdictRank()===shownRank()&&",
  "ok('overall verdict match-back and detailed rank use one answer',verdictMB()===shownRank()&&"),
 ("  verdictRank()===shownRank()&&\n  new RegExp(Math.round((selected2025Rank.band||selected2025Rank.all).p)",
  "  verdictMB()===shownRank()&&\n"
  "  verdictRank()===Math.round(w.DD.demand(R,Date.UTC(2025,0,1),Date.UTC(2026,0,1)-1,'men').rank.p)&&\n"
  "  new RegExp(Math.round((selected2025Rank.band||selected2025Rank.all).p)"),
])

edit(unit, [
 ("const snap=JSON.stringify(DD.snapshot(R,M));",
  "const S0=DD.snapshot(R,M);const snap=JSON.stringify(S0);"),
 ("   (snap.match(/https?:\\/\\//g)||[]).length<=1&&/swipestats\\.io/.test(snap));",
  "   (snap.match(/https?:\\/\\/[^\"]+/g)||[]).every(u=>/swipestats\\.io/.test(u))&&/swipestats\\.io/.test(snap));\n"
  "ok('snapshot carries demand with numerator, weeks, band and modelled flag',\n"
  "   !!S0.demand&&S0.demand.n>=DD.MIN_N&&S0.demand.weeks>=4&&S0.demand.rank.band.length===2&&S0.demand.rank.modelled===true);\n"
  "ok('demand rank monotone in likes per week',DD.demandRank(2,'men').p<DD.demandRank(8,'men').p&&DD.demandRank(8,'men').p<DD.demandRank(16,'men').p);\n"
  "ok('demand band brackets the point estimate',(()=>{const r=DD.demandRank(16,'men');return r.band[0]<r.p&&r.p<r.band[1];})());\n"
  "ok('demand sigma reproduces the published top-10% share',Math.abs(1-DD.Phi(DD.Phinv(.9)-DD.DEMAND_BENCH.sigma)-.58)<1e-9);\n"
  "ok('demand refuses a women rank with a stated reason',DD.demandRank(16,'women').available===false&&/99\\+/.test(DD.demandRank(16,'women').reason));\n"
  "ok('demand is per calendar week, not per active day',(()=>{const d=DD.demand(R,R.minT,R.maxT,'men');return Math.abs(d.weeks-(R.maxT-R.minT)/(7*864e5))<1e-9;})());"),
])
print("patched tests in", D)

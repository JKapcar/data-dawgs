import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

let pass = 0;
const ok = (name, condition) => { assert.ok(condition, name); pass++; console.log("  ok   " + name); };
const root = path.resolve(".");
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://local").pathname;
  const safe = pathname === "/" ? "dawgs.html" : pathname.slice(1);
  const file = path.join(root, safe);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file);
  res.setHeader("Content-Type", ext === ".html" ? "text/html; charset=utf-8" : ext === ".jpg" ? "image/jpeg" : ext === ".mp4" ? "video/mp4" : "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/dawgs.html`;
const browser = await chromium.launch({ headless: true });
const shots = path.join(root, "work", ".shots");
fs.mkdirSync(shots, { recursive: true });

const emptyProfile = { responseCount:0, completedQuizCount:0, meanForecast:null, truthRate:null,
  calibrationBias:null, meanBrierLoss:null, accuracy:null, accuracyDenominator:0,
  bins:[[0,20],[21,40],[41,60],[61,80],[81,100]].map(([min,max])=>({min,max,label:`${min}–${max}`,responseCount:0,meanForecast:null,truthRate:null})),
  milestone:{label:"Profile in progress",threshold:0,next:40,remaining:40}, history:[] };
const domains = [
  {key:"sports",label:"Sports"},{key:"biology",label:"Biology"}
];
const noDomains = { sports:{...emptyProfile}, biology:{...emptyProfile} };

try {
  console.log("\nsigned-out sheets");
  const rollo = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await rollo.route(/youtube|googlevideo|burst-/, r => r.abort());
  await rollo.goto(url, { waitUntil: "domcontentloaded" });
  ok("hero heading is real DOM copy", (await rollo.locator("#poundTitle").textContent()) === "Dawg Pound" && (await rollo.locator(".dp-welcome").textContent()).includes("Good ideas need room to run."));
  const heroImage = await rollo.locator(".dp-hero-art").evaluate(img => ({complete:img.complete,naturalWidth:img.naturalWidth,width:img.getAttribute("width"),height:img.getAttribute("height")}));
  ok("hero image loads with intrinsic dimensions", heroImage.complete && heroImage.naturalWidth > 0 && heroImage.width === "1944" && heroImage.height === "810");
  ok("desktop hero causes no body overflow", await rollo.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
  const rolloColumns = await rollo.locator(".rollo-grid").evaluate(el => {
    const media = el.querySelector(".rollo-media").getBoundingClientRect();
    const story = el.querySelector(".rollo-story").getBoundingClientRect();
    return { ratio: media.width / story.width, stacked: story.top > media.bottom };
  });
  ok("Rollo desktop layout keeps the media at roughly two-thirds", rolloColumns.ratio > 1.75 && rolloColumns.ratio < 2.25 && !rolloColumns.stacked);
  ok("Rollo playback and attribution controls remain present", await rollo.locator("#btnPlay").isVisible() && await rollo.locator("#credit a[href*='youtube.com']").isVisible());
  await rollo.screenshot({path:path.join(shots,"rollo-desktop-light.png"),fullPage:true});
  await rollo.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/youtube|googlevideo|burst-|\.jpg$/, r => r.abort());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  ok("mobile hero is a full-scene horizontal viewport", await page.locator("#dpHeroScroll").evaluate(el => el.scrollWidth > el.clientWidth));
  ok("mobile pan cue starts visible", await page.locator("#dpHeroHint").isVisible());
  await page.locator("#dpHeroScroll").evaluate(el => el.scrollLeft = 80);
  await page.waitForTimeout(50);
  ok("mobile pan cue retires after horizontal scroll", await page.locator(".dp-hero").evaluate(el => el.classList.contains("panned")));
  ok("Rollo is the default sheet", await page.locator("#rolloSheet").isVisible() && !(await page.locator("#ddccSheet").isVisible()));
  await page.locator("#rolloTab").hover();
  ok("hover preview does not mutate hash", new URL(page.url()).hash === "" && (await page.locator("#dpProjectPreview").innerText()).includes("music-synced photo tribute"));
  await page.locator("#ddccTab").click();
  await page.locator("#ddccSheet").waitFor({state:"visible"});
  ok("DDCC sheet writes restorable URL state", new URL(page.url()).hash === "#ddcc" && await page.locator("#ddccSheet").isVisible());
  ok("only the active sheet is visible", !(await page.locator("#rolloSheet").isVisible()));
  ok("signed-out demonstration is present", await page.locator("#ddccDemo").isVisible() && await page.locator("#ddccSignIn").isVisible());
  ok("centered demo control is initially unanswered", await page.locator("#ddccDemoOut").innerText() === "Not answered");
  await page.locator("#ddccDemo").fill("67");
  ok("demo reports deliberate interaction", await page.locator("#ddccDemoOut").innerText() === "67%");
  await page.goBack();
  ok("browser back restores Rollo", await page.locator("#rolloSheet").isVisible());
  await page.locator("#rolloTab").focus(); await page.keyboard.press("ArrowRight");
  ok("arrow key selects and focuses DDCC", await page.locator("#ddccTab").getAttribute("aria-selected") === "true" && await page.locator("#ddccTab").evaluate(e => e === document.activeElement));
  ok("focused DDCC exposes its preview", (await page.locator("#dpProjectPreview").innerText()).includes("Put probabilities on 40 claims"));
  await page.locator("#ddccSheet .dp-sheet-close").click();
  ok("collapse preserves active project and hash", new URL(page.url()).hash === "#ddcc" && !(await page.locator("#ddccSheet").isVisible()));
  await page.locator("#ddccTab").click();
  ok("one click reopens the collapsed project", await page.locator("#ddccSheet").isVisible() && new URL(page.url()).hash === "#ddcc");
  await page.screenshot({path:path.join(shots,"ddcc-mobile-signed-out.png"),fullPage:true});
  await page.close();

  console.log("\nsigned-in quiz");
  const quiz = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const token = Buffer.from(JSON.stringify({n:"Kap",e:Date.now()+86400000})).toString("base64url") + ".test";
  await quiz.addInitScript(t => localStorage.setItem("dd-bozo-sess", t), token);
  let active = null, lastAnswer = null;
  await quiz.route("https://toto.jkapcar4.workers.dev/ddcc/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/ddcc/state") return route.fulfill({json:{ok:true,activeAttempt:active,profile:emptyProfile,domainProfiles:noDomains,domains}});
    if (pathname === "/ddcc/start") {
      active={id:"attempt-1",status:"in_progress",currentIndex:0,completedCount:0,total:40,startedAt:new Date().toISOString(),currentQuestion:{id:"sports-001",claim:"An NBA regulation period lasts 12 minutes.",domain:"sports",domainLabel:"Sports",version:1}};
      return route.fulfill({status:201,json:{ok:true,activeAttempt:active,profile:emptyProfile,domainProfiles:noDomains,domains}});
    }
    if (pathname === "/ddcc/answer") {
      lastAnswer=JSON.parse(route.request().postData());
      active={...active,currentIndex:1,completedCount:1,currentQuestion:{id:"biology-001",claim:"DNA uses four types of nitrogen bases.",domain:"biology",domainLabel:"Biology",version:1}};
      return route.fulfill({json:{ok:true,activeAttempt:active,profile:emptyProfile,domainProfiles:noDomains,domains}});
    }
    return route.fulfill({status:404,json:{error:"not found"}});
  });
  await quiz.route(/youtube|googlevideo|burst-|\.jpg$/, r => r.abort());
  await quiz.goto(url + "#ddcc", { waitUntil:"domcontentloaded" });
  await quiz.locator("#ddccLaunch").click();
  await quiz.locator("#quizClaim").waitFor({state:"visible"});
  ok("official quiz shows one claim and progress", await quiz.locator("#quizClaim").innerText() === "An NBA regulation period lasts 12 minutes." && /question 1 of 40/i.test(await quiz.locator(".quiz-progress").innerText()));
  await quiz.screenshot({path:path.join(shots,"ddcc-desktop-quiz.png"),fullPage:true});
  ok("active payload has no answer key fields", !("truthValue" in active.currentQuestion) && !("explanation" in active.currentQuestion));
  ok("untouched slider cannot submit", await quiz.locator("#ddccLock").isDisabled());
  await quiz.locator("#ddccProbability").fill("73");
  ok("whole-number probability enables explicit lock", !(await quiz.locator("#ddccLock").isDisabled()) && await quiz.locator("#ddccProbabilityOut").innerText() === "73%");
  await quiz.locator("#ddccLock").click();
  await quiz.locator("#quizClaim").filter({hasText:"DNA uses"}).waitFor();
  ok("persisted answer advances once", lastAnswer.probability === 73 && lastAnswer.questionId === "sports-001" && /question 2 of 40/i.test(await quiz.locator(".quiz-progress").innerText()));
  await quiz.locator("#ddccPause").click();
  ok("pause returns to resumable launcher", /1 of 40 answers/.test(await quiz.locator("#ddccApp").innerText()) && /Resume quiz/.test(await quiz.locator("#ddccLaunch").innerText()));
  await quiz.close();

  console.log("\nprofile chart and receipt");
  const profilePage = await browser.newPage({ viewport:{width:1280,height:1000} });
  await profilePage.addInitScript(t => localStorage.setItem("dd-bozo-sess", t), token);
  const bins = [
    {min:0,max:20,label:"0–20",responseCount:8,meanForecast:.1,truthRate:.125},
    {min:21,max:40,label:"21–40",responseCount:8,meanForecast:.32,truthRate:.25},
    {min:41,max:60,label:"41–60",responseCount:8,meanForecast:.53,truthRate:.5},
    {min:61,max:80,label:"61–80",responseCount:8,meanForecast:.71,truthRate:.75},
    {min:81,max:100,label:"81–100",responseCount:8,meanForecast:.9,truthRate:.875},
  ];
  const profile={responseCount:40,completedQuizCount:1,meanForecast:.512,truthRate:.5,calibrationBias:.012,meanBrierLoss:.18,accuracy:.7,accuracyDenominator:40,bins,milestone:{label:"Initial DDCC Profile",threshold:40,next:100,remaining:60},history:[{id:"done-1",completedAt:"2026-08-12T12:00:00Z",responseCount:40,meanBrierLoss:.18,calibrationBias:.012}]};
  const domainProfiles={sports:{...profile,responseCount:2,bins:[{...bins[0],responseCount:0,meanForecast:null,truthRate:null},{...bins[1],responseCount:0,meanForecast:null,truthRate:null},{...bins[2],responseCount:0,meanForecast:null,truthRate:null},{...bins[3],responseCount:2,meanForecast:.72,truthRate:.5},{...bins[4],responseCount:0,meanForecast:null,truthRate:null}]},biology:{...emptyProfile}};
  await profilePage.route("https://toto.jkapcar4.workers.dev/ddcc/**", async route => {
    const u=new URL(route.request().url());
    if(u.pathname==="/ddcc/state") return route.fulfill({json:{ok:true,activeAttempt:null,profile,domainProfiles,domains}});
    if(u.pathname==="/ddcc/review") return route.fulfill({json:{ok:true,attempt:{id:"done-1",completedAt:"2026-08-12T12:00:00Z",scoringVersion:"ddcc-v1",metrics:profile,responses:Array.from({length:40},(_,i)=>({claimSnapshot:"Resolved claim "+(i+1),probability:i?70:95,truthValueSnapshot:i!==0,brierLoss:i?0.09:0.9025,explanationSnapshot:"Verified explanation.",sourceTitleSnapshot:"Authoritative source",sourceUrlSnapshot:"https://example.com/source"}))}}});
  });
  await profilePage.route(/youtube|googlevideo|burst-|\.jpg$/, r => r.abort());
  await profilePage.goto(url+"#ddcc",{waitUntil:"domcontentloaded"});
  await profilePage.locator("#profileTitle").waitFor({state:"visible"});
  ok("profile renders required metrics and milestone", /Initial DDCC Profile/.test(await profilePage.locator("#ddccApp").innerText()) && /mean brier loss/i.test(await profilePage.locator("#ddccApp").innerText()) && /directional accuracy/i.test(await profilePage.locator("#ddccApp").innerText()));
  await profilePage.screenshot({path:path.join(shots,"ddcc-desktop-profile-light.png"),fullPage:true});
  ok("chart has diagonal and five data rows", await profilePage.locator(".cal-chart .ideal").count()===1 && await profilePage.locator(".chart-data tbody tr").count()===5);
  await profilePage.locator("#ddccScope").selectOption("biology");
  ok("empty domain has honest empty state and zero count", /0 qualifying responses/.test(await profilePage.locator(".ddcc-chart-card").innerText()) && /No completed responses/.test(await profilePage.locator("#ddccChart").innerText()));
  await profilePage.locator("[data-review]").click();
  await profilePage.locator(".review-item").first().waitFor({state:"visible"});
  ok("completed receipt reveals sources and highlights high-confidence miss", await profilePage.locator(".review-item").count()===40 && await profilePage.locator(".review-item.miss").count()===1 && /Authoritative source/.test(await profilePage.locator(".ddcc-review").innerText()));
  await profilePage.close();

  const dark = await browser.newPage({viewport:{width:390,height:844}});
  await dark.addInitScript(([t,token])=>{localStorage.setItem("dd-theme2-dawgs",t);localStorage.setItem("dd-bozo-sess",token);},["dark",token]);
  await dark.route("https://toto.jkapcar4.workers.dev/ddcc/**", route=>route.fulfill({json:{ok:true,activeAttempt:null,profile,domainProfiles,domains}}));
  await dark.route(/youtube|googlevideo|burst-|\.jpg$/, r => r.abort());
  await dark.goto(url+"#ddcc",{waitUntil:"domcontentloaded"}); await dark.locator("#profileTitle").waitFor();
  ok("mobile dark theme preserves DDCC profile content", await dark.locator("html").getAttribute("data-theme")==="dark" && await dark.locator("#profileTitle").isVisible());
  await dark.screenshot({path:path.join(shots,"ddcc-mobile-profile-dark.png"),fullPage:true});
  await dark.close();

  console.log(`\n${pass} DDCC UI assertions passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

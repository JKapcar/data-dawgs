(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var WORKER = "https://toto.jkapcar4.workers.dev";
  var PROFILE_KEY = "dd-auth-profile-v1";
  var CONNECTOR_KEY = "dd-mcp-active-v1";
  var selectedEmail = "";
  var qs = new URLSearchParams(location.search);
  var next = qs.get("next") || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(next) || next === "signon.html") next = "";
  var leagueCode = qs.get("league") || "";
  if (!/^[A-Za-z0-9_-]{22}$/.test(leagueCode)) leagueCode = "";
  var joinTok = qs.get("join") || "";
  var resetTok = qs.get("reset") || "";
  var verifyTok = qs.get("verify") || "";
  var emailTok = qs.get("email-change") || "";
  var leaguePending = !!leagueCode;
  var leagueInfo = null;

  function msg(id, text, kind) {
    var el = $(id); if (!el) return;
    el.textContent = text || "";
    el.className = "note" + (kind ? " " + kind : "");
  }
  function profile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch (_) { return null; } }
  function saveProfile(value) { if (value) localStorage.setItem(PROFILE_KEY, JSON.stringify(value)); else localStorage.removeItem(PROFILE_KEY); }
  function tokenData() {
    try {
      var token = localStorage.getItem("dd-bozo-sess") || "";
      var raw = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(raw));
    } catch (_) { return {}; }
  }
  function session() { return localStorage.getItem("dd-bozo-sess") || ""; }
  function setSession(j, fallback) {
    if (!j.session) throw new Error("No session came back.");
    window.DDAuth.set(j.session);
    var old = profile() || {};
    var tok = tokenData();
    saveProfile({ uid:j.uid || tok.u || old.uid || null, name:j.name || tok.n || fallback.name || old.name || "Member", email:j.email || fallback.email || old.email || "", emailVerified:j.emailVerified === true || old.emailVerified === true });
  }
  async function api(path, body, method) {
    var headers = { "Content-Type":"application/json" };
    if (session()) { headers["X-Dawg-Session"] = session(); headers["X-Bozo-Session"] = session(); }
    var res = await fetch(WORKER + path, { method:method || "POST", headers:headers, body:body == null ? undefined : JSON.stringify(body), cache:"no-store" });
    var renewed = res.headers.get("X-Dawg-Session") || res.headers.get("X-Bozo-Session");
    if (renewed) window.DDAuth.set(renewed);
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(json.error || ("Request failed (" + res.status + ").")); e.status=res.status; e.body=json; throw e; }
    return json;
  }
  function leave() { if (leaguePending) return true; if (next) { location.replace(next); return true; } return false; }

  if (joinTok || resetTok || verifyTok || emailTok) {
    history.replaceState(null, "", location.pathname + (next ? "?next=" + encodeURIComponent(next) : ""));
  }

  document.querySelectorAll("[data-show]").forEach(function (box) {
    box.addEventListener("change", function () { var input=$(box.dataset.show); if (input) input.type=box.checked?"text":"password"; });
  });

  function showEmailStep() {
    selectedEmail=""; $("stepEmail").hidden=false; $("stepKnown").hidden=true; $("stepCreate").hidden=true; msg("lookupMsg",""); $("sEmail").focus();
  }
  document.querySelectorAll("[data-email-back]").forEach(function (b) { b.addEventListener("click", showEmailStep); });
  async function lookup() {
    var email=$("sEmail").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("lookupMsg","That doesn't look like an email address.","bad"); return; }
    msg("lookupMsg","Checking…");
    try {
      var j=await api("/auth/lookup",{email:email}); selectedEmail=email; $("stepEmail").hidden=true;
      if (j.known) { $("knownEmail").textContent=email; $("stepKnown").hidden=false; $("sPw").focus(); }
      else { $("createEmail").textContent=email; $("stepCreate").hidden=false; $("nName").focus(); }
    } catch(e) { msg("lookupMsg",e.message,"bad"); }
  }
  $("lookupGo").addEventListener("click",lookup); $("sEmail").addEventListener("keydown",function(e){if(e.key==="Enter")lookup();});

  async function signIn() {
    var pw=$("sPw").value;
    if (!selectedEmail || !pw) { msg("sMsg","Email and password, both.","warn"); return; }
    msg("sMsg","Signing in…");
    try { var j=await api("/auth/login",{email:selectedEmail,password:pw}); $("sPw").value=""; setSession(j,{email:selectedEmail}); if (leagueCode) { render(); await redeemLeague(); } else if (!leave()) render(); }
    catch(e){msg("sMsg",e.message,"bad");}
  }
  $("sGo").addEventListener("click",signIn); $("sPw").addEventListener("keydown",function(e){if(e.key==="Enter")signIn();});
  $("nGo").addEventListener("click",async function(){
    var name=$("nName").value.trim(), pw=$("nPw").value;
    if(!name){msg("nMsg","Pick a name — it's what shows on rosters.","warn");return;} if(pw.length<8){msg("nMsg","Password must be at least 8 characters.","warn");return;}
    msg("nMsg","Creating…"); try{var j=await api("/auth/signup",{name:name,email:selectedEmail,password:pw});$("nPw").value="";setSession(j,{name:name,email:selectedEmail});if(leagueCode){render();await redeemLeague();}else if(!leave())render();}catch(e){msg("nMsg",e.message,"bad");}
  });
  $("forgotOpen").addEventListener("click",function(){ $("sHelp").open=true; $("fEmail").value=selectedEmail; $("fEmail").focus(); });
  $("fGo").addEventListener("click",async function(){var email=$("fEmail").value.trim();if(!email){msg("fMsg","Enter your email.","warn");return;}msg("fMsg","Sending…");try{var j=await api("/auth/forgot",{email:email});msg("fMsg",j.note || "If that address is on an account, the reset link is on its way.","good");}catch(e){msg("fMsg",e.message,"bad");}});

  $("jGo").addEventListener("click",async function(){var pw=$("jPw").value,pw2=$("jPw2").value,email=$("jEmail").value.trim();if(pw.length<8){msg("jMsg","Password must be at least 8 characters.","warn");return;}if(pw!==pw2){msg("jMsg","Those passwords don't match.","warn");return;}msg("jMsg","Claiming…");try{var j=await api("/auth/claim",{token:joinTok,password:pw});setSession(j,{name:j.name,email:email});if(email)await api("/auth/email",{email:email});joinTok="";if(!leave())render();}catch(e){msg("jMsg",e.message,"bad");}});

  $("rGo").addEventListener("click",async function(){var a=$("rPw").value,b=$("rPw2").value;if(a.length<8){msg("rMsg","Password must be at least 8 characters.","warn");return;}if(a!==b){msg("rMsg","Those passwords don't match.","warn");return;}try{var j=await api("/auth/reset-password",{token:resetTok,password:a});resetTok="";setSession(j,{});msg("rMsg","Password changed. Every older session is ended.","good");render();}catch(e){msg("rMsg",e.message,"bad");}});

  async function confirmToken(path, token) { $("sVerify").hidden=false; try{var j=await api(path,{token:token});var p=profile()||{};if(path==="/auth/verify")p.emailVerified=true;if(j.email)p.email=j.email;saveProfile(p);msg("vMsg",path==="/auth/verify"?"Email confirmed. You can now create your personal connector.":"New email confirmed and now used for sign-in.","good");}catch(e){msg("vMsg",e.message,"bad");} }
  if(verifyTok)confirmToken("/auth/verify",verifyTok);if(emailTok)confirmToken("/auth/email-confirm",emailTok);

  function paintLeague(){if(!leagueCode){$("sLeague").hidden=true;return;}$("sLeague").hidden=false;var m=window.DDAuth.me();$("lgName").textContent=leagueInfo?(leagueInfo.name||leagueInfo.league):"";$("lgGo").hidden=!m||!leagueInfo;if(!leagueInfo){$("lgSub").textContent="Checking that link…";return;}if(leagueInfo.full&&!m){$("lgSub").textContent="This league is full ("+leagueInfo.cap+" members). Ask "+(leagueInfo.manager||"the manager")+" to raise the cap.";return;}$("lgSub").textContent=m?"You're signed in as "+m.name+". "+leagueInfo.size+" of "+leagueInfo.cap+" seats used.":"Sign in or create an account and you'll join automatically. "+leagueInfo.size+" of "+leagueInfo.cap+" seats used.";}
  async function previewLeague(){try{var r=await fetch(WORKER+"/league/join?code="+encodeURIComponent(leagueCode),{cache:"no-store"}),j=await r.json();if(!r.ok)throw new Error(j.error||"That link didn't work.");leagueInfo=j;paintLeague();if(window.DDAuth.me())await redeemLeague();}catch(e){leagueCode="";leaguePending=false;$("sLeague").hidden=false;$("lgName").textContent="";$("lgSub").textContent=e.message;$("lgGo").hidden=true;render();}}
  async function redeemLeague(){if(!leagueCode)return;msg("lgMsg","Joining…");try{var j=await api("/league/join",{code:leagueCode});var name=j.name||"the league";leagueCode="";leaguePending=false;history.replaceState(null,"",location.pathname+(next?"?next="+encodeURIComponent(next):""));$("lgGo").hidden=true;$("lgSub").textContent=j.already?"You were already in "+name+".":"You're in "+name+" — "+j.size+" members now.";msg("lgMsg",j.already?"":"Joined.","good");if(!leave())render();}catch(e){leaguePending=false;msg("lgMsg",e.message,"bad");if(next)$("meBack").hidden=false;}}
  $("lgGo").addEventListener("click",redeemLeague);if(leagueCode)previewLeague();

  var PANELS={dawgs:"pDawgs",connect:"pConnect",build:"pBuild",account:"pAccount"};
  function showSheet(id){if(!PANELS[id])id="dawgs";document.querySelectorAll(".sheet-tab").forEach(function(t){var on=t.dataset.sheet===id;t.classList.toggle("on",on);t.setAttribute("aria-selected",on?"true":"false");t.tabIndex=on?0:-1;$(PANELS[t.dataset.sheet]).hidden=!on;});history.replaceState(null,"",location.pathname+location.search+"#"+id);}
  document.querySelectorAll(".sheet-tab").forEach(function(t){t.addEventListener("click",function(){showSheet(t.dataset.sheet);});t.addEventListener("keydown",function(e){var tabs=[].slice.call(document.querySelectorAll(".sheet-tab")),i=tabs.indexOf(t),n;if(e.key==="ArrowRight")n=tabs[(i+1)%tabs.length];if(e.key==="ArrowLeft")n=tabs[(i-1+tabs.length)%tabs.length];if(n){e.preventDefault();n.focus();showSheet(n.dataset.sheet);}});});

  function formatDeadline(ms){if(ms==null)return "Nothing needs you right now.";var d=new Date(ms),days=Math.ceil((ms-Date.now())/86400000);return "Closes "+d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+(days>=0?" · "+days+" day"+(days===1?"":"s"):"");}
  function paintRows(rows){var box=$("dawgRows");box.replaceChildren();$("dawgsEmpty").hidden=rows.length>0;$("dawgCount").textContent=rows.length?String(rows.length):"None";$("helloSub").textContent=rows.length?rows.length+" thing"+(rows.length===1?"":"s")+" connected to you.":"Nothing has your name on it yet.";rows.forEach(function(r){var row=document.createElement("div");row.className="dawgrow";row.innerHTML='<div class="body"><p class="ttl"><a></a> <span class="tick idle"></span></p><p class="when"></p><p class="standing"></p></div><div class="act"><a class="btn sm ghost"></a></div>';row.querySelector("a").textContent=r.title;row.querySelector("a").href=r.href;row.querySelector(".tick").textContent=r.status;row.querySelector(".when").textContent=r.deadline==null?r.action:formatDeadline(r.deadline);row.querySelector(".standing").textContent=r.detail;var a=row.querySelector(".act a");a.textContent=r.actionLabel;a.href=r.href;box.appendChild(row);});}
  async function loadDawgs(){try{var j=await api("/league/mine",null,"GET");paintRows(window.DDSummarize.summarize({leagues:j.leagues,connector:{active:localStorage.getItem(CONNECTOR_KEY)==="1"}}));}catch(e){if(e.status===403){$("dawgRows").innerHTML='<p class="note warn">This is a legacy session. Existing pages still work, but new personal league features require signing up through the new email-first door after the planned account transition.</p>';$("dawgCount").textContent="Legacy";$("helloSub").textContent="Your existing session is still valid.";}else{$("dawgRows").innerHTML='<p class="note bad"></p>';$("dawgRows").firstChild.textContent=e.message;}}}

  var PROV={claude:{add:"Claude → Settings → Connectors → Add custom connector → paste the URL → Save.",proj:"Create a DataDawgs project, paste the instructions below, then in each project chat check that the Data Dawgs connector is enabled — connectors are turned on per conversation."},chatgpt:{add:"ChatGPT custom MCP apps require an eligible Business or Enterprise/Edu workspace and an admin or owner to add the app. Paste the URL during app setup.",proj:"Create a DataDawgs project and paste the instructions below. If your workspace does not offer custom MCP apps, use another supported provider."},gemini:{add:"Gemini Spark on the web → Settings & help → Connected Apps → Custom apps for Spark → add the URL. Spark custom apps currently require a US personal Google account, age 18+, English and Keep Activity on.",proj:"Create a saved DataDawgs chat in Spark and keep the instructions below with it."},other:{add:"Use the URL as a Streamable HTTP MCP endpoint. If supported, send the credential as Authorization: Bearer or X-Dawg-Pass instead of placing it in a URL.",proj:"Paste the instructions below wherever your client keeps standing project instructions."}};
  document.querySelectorAll(".provbtn").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll(".provbtn").forEach(function(x){x.classList.remove("on");});b.classList.add("on");$("stepAddP").textContent=PROV[b.dataset.prov].add;$("stepProjP").textContent=PROV[b.dataset.prov].proj;});});$("stepAddP").textContent=PROV.claude.add;$("stepProjP").textContent=PROV.claude.proj;
  fetch("/data/dawg-project-instructions.md",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("Instructions unavailable.");return r.text();}).then(function(t){$("instrBox").textContent=t.replace(/^---[\s\S]*?---\s*/,"");}).catch(function(e){$("instrBox").textContent=e.message;});
  $("copyInstr").addEventListener("click",async function(){try{await navigator.clipboard.writeText($("instrBox").textContent);$("copyInstr").textContent="Copied";setTimeout(function(){$("copyInstr").textContent="Copy instructions";},1400);}catch(_){msg("cMintMsg","Select and copy the text above.","warn");}});
  $("cMint").addEventListener("click",async function(){msg("cMintMsg","Creating…");try{var j=await api("/auth/mcp-token",{action:"mint"});$("cUrl").value=j.url;$("cUrlBox").hidden=false;$("cMint").textContent="Replace it";localStorage.setItem(CONNECTOR_KEY,"1");msg("cMintMsg","Shown once. Save it now; replacing it kills the old URL immediately.","warn");loadDawgs();}catch(e){msg("cMintMsg",e.body&&e.body.verificationRequired?"Confirm your email first. Open Account and send the confirmation link.":e.message,e.body&&e.body.verificationRequired?"warn":"bad");}});
  $("cCopy").addEventListener("click",async function(){try{await navigator.clipboard.writeText($("cUrl").value);$("cCopy").textContent="Copied";}catch(_){msg("cMintMsg","Select and copy the URL.","warn");}});
  $("cRevoke").addEventListener("click",async function(){msg("cMintMsg","Turning it off…");try{await api("/auth/mcp-token",{action:"revoke"});$("cUrl").value="";$("cUrlBox").hidden=true;$("cMint").textContent="Create my URL";localStorage.removeItem(CONNECTOR_KEY);msg("cMintMsg","Connector turned off.","good");loadDawgs();}catch(e){msg("cMintMsg",e.message,"bad");}});

  $("pGo").addEventListener("click",async function(){var old=$("pOld").value,nw=$("pNew").value;if(nw.length<8){msg("pMsg","New password must be at least 8 characters.","warn");return;}try{var j=await api("/auth/passwd",{oldPassword:old,newPassword:nw});setSession(j,profile()||{});$("pOld").value=$("pNew").value="";msg("pMsg","Changed. Every older session on every device is now ended.","good");}catch(e){msg("pMsg",e.message,"bad");}});
  $("eGo").addEventListener("click",async function(){var email=$("eEmail").value.trim();if(!email){msg("eMsg","Enter the new email.","warn");return;}try{var j=await api("/auth/email",{email:email});msg("eMsg",j.note||"Confirmation sent to the new address. Your current login stays unchanged until you open it.","good");}catch(e){msg("eMsg",e.message,"bad");}});
  $("vGo").addEventListener("click",async function(){var b=this;b.disabled=true;b.setAttribute("aria-busy","true");msg("vrMsg","Requesting confirmation from the email provider…","warn");try{var j=await api("/auth/verify-request",{});if(j.alreadyVerified){var p=profile()||{};p.emailVerified=true;saveProfile(p);msg("vrMsg","This email is already confirmed.","good");}else if(j.sent&&j.providerAccepted)msg("vrMsg",j.note||"Email provider accepted the confirmation. Check your inbox and spam.","good");else throw new Error("The server did not confirm that the email provider accepted the request.");}catch(e){msg("vrMsg","Confirmation email failed: "+e.message,"bad");}finally{b.disabled=false;b.removeAttribute("aria-busy");}});
  $("meOut").addEventListener("click",function(){window.DDAuth.clear();saveProfile(null);localStorage.removeItem(CONNECTOR_KEY);showEmailStep();render();});

  function render(){var m=window.DDAuth&&window.DDAuth.me(),resetting=!!resetTok;$("sReset").hidden=!resetting;$("signedOut").hidden=!!m||resetting;$("sMe").hidden=!m||resetting;if(resetting)$("sVerify").hidden=true;$("sJoin").hidden=!!m||!joinTok||resetting;$("sIn").hidden=!!joinTok;$("sHelp").hidden=!!joinTok;$("meJoinWarn").hidden=!(m&&joinTok);paintLeague();if(resetting)$("sLeague").hidden=true;if(m){var p=profile()||{},days=Math.max(0,Math.round((m.expires-Date.now())/86400000));$("meName").textContent=p.name||m.name;$("meEmail").textContent=p.email?(" · "+p.email):"";$("meExp").textContent="Signed in on this device for about "+days+" more day"+(days===1?"":"s")+".";$("hello").textContent="Welcome, "+(p.name||m.name);$("meBack").hidden=!next;if(next)$("meBack").href=next;loadDawgs();showSheet(location.hash.slice(1)||"dawgs");}}
  render();
})();

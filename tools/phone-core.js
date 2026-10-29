/* =====================================================================
   HUB PHONE — the calling engine, loaded once by the hub (index.html), never inside a tool.
   See docs/FEATURE-hub-phone.md
   · keeps one WebSocket to /api/phone/ws while the hub is open (reconnects by itself)
   · shows the incoming call over the whole hub (ringtone + vibration), Answer / Decline
   · runs the call (WebRTC): mute, camera on / off, flip camera, minimise, hang up
   The Hub Phone page (tools/phone.html) calls window.parent.HubPhone.call(email, video).
   ===================================================================== */
(function(){
  if (window.HubPhone) return;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ini = s => String(s || "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 20);
  const DEV = (() => { try { let d = sessionStorage.getItem("hub.phoneDev"); if (!d){ d = rid().slice(0, 12); sessionStorage.setItem("hub.phoneDev", d); } return d; } catch { return rid().slice(0, 12); } })();
  const api = (p, b) => window.HUBX ? HUBX.api(p, b) : Promise.reject(new Error("hub not ready"));
  const listeners = new Set(), emit = () => { try { paintFab(); } catch {} listeners.forEach(f => { try { f(state()); } catch {} }); };

  let ws = null, wsOk = false, backoff = 1000, pingT = 0, ICE = null, ICE_AT = 0;
  let C = null;            // the current call
  let ringing = null;      // an incoming call waiting for an answer
  const state = () => ({ connected: wsOk, inCall: !!C, call: C ? { peer: C.peer, peerName: C.peerName, video: C.video, state: C.state } : null, ringing: !!ringing });

  /* ---------- sound: ringtone (incoming) and ring-back (outgoing), made in the browser ---------- */
  let AC = null, toneT = 0, toneNodes = [];
  function unlock(){ try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch {} }
  addEventListener("pointerdown", unlock, { passive: true }); addEventListener("keydown", unlock);
  function beep(freqs, ms, vol){
    if (!AC || AC.state !== "running") return;
    const g = AC.createGain(); g.gain.value = vol; g.connect(AC.destination);
    freqs.forEach(f => { const o = AC.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); o.stop(AC.currentTime + ms / 1000); toneNodes.push(o); });
  }
  function toneOn(kind){
    toneOff(); unlock();
    const run = () => {
      if (kind === "in"){ beep([440, 480], 1000, .22); setTimeout(() => beep([440, 480], 900, .22), 1200);
        if (navigator.vibrate) navigator.vibrate([900, 300, 900]); }
      else beep([425], 1000, .08);
    };
    run(); toneT = setInterval(run, kind === "in" ? 3600 : 4000);
  }
  function toneOff(){ clearInterval(toneT); toneT = 0; toneNodes.forEach(o => { try { o.stop(); } catch {} }); toneNodes = []; if (navigator.vibrate) navigator.vibrate(0); }
  const blip = () => { unlock(); beep([620], 160, .12); setTimeout(() => beep([480], 220, .12), 200); };

  /* ---------- the screen over the hub ---------- */
  const css = document.createElement("style");
  css.textContent = `
#hpBox{position:fixed;inset:0;z-index:2147483000;display:none;background:radial-gradient(120% 90% at 50% 0%,#4A1F73 0%,#2A0F45 55%,#14081F 100%);color:#fff;font-family:inherit}
#hpBox.on{display:flex;flex-direction:column}
#hpBox .hp-top{padding:calc(env(safe-area-inset-top,0px) + 18px) 18px 0;display:flex;justify-content:space-between;align-items:center;font-size:.78rem;color:rgba(255,255,255,.7);font-weight:700;letter-spacing:.04em}
#hpBox .hp-top button{color:#fff;background:rgba(255,255,255,.12);border-radius:999px;padding:7px 12px;font-weight:700;font-size:.78rem}
#hpBox .hp-mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;text-align:center;position:relative}
#hpBox .hp-av{width:116px;height:116px;border-radius:50%;background:#C8A24A;color:#2A0F45;display:grid;place-items:center;font-size:2.4rem;font-weight:900;box-shadow:0 0 0 10px rgba(200,162,74,.16),0 0 0 22px rgba(200,162,74,.07)}
#hpBox.ring .hp-av{animation:hpPulse 1.6s ease-in-out infinite}
@keyframes hpPulse{50%{box-shadow:0 0 0 16px rgba(200,162,74,.22),0 0 0 34px rgba(200,162,74,.08)}}
#hpBox h2{margin:8px 0 0;font-size:1.6rem;font-weight:800;color:#fff}
#hpBox .hp-sub{font-size:.92rem;color:rgba(255,255,255,.75)}
#hpBox .hp-st{font-size:.95rem;color:#E9CF8A;font-weight:700;min-height:1.3em}
#hpBox .hp-bot{padding:0 18px calc(env(safe-area-inset-bottom,0px) + 28px);display:flex;justify-content:center;gap:18px;flex-wrap:wrap}
#hpBox .hp-b{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:.72rem;font-weight:700;color:rgba(255,255,255,.85);background:none}
#hpBox .hp-b i{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.14);font-style:normal;font-size:1.5rem}
#hpBox .hp-b.off i{background:#fff;color:#2A0F45}
#hpBox .hp-b.red i{background:#E5484D}
#hpBox .hp-b.green i{background:#2EB872}
#hpBox .hp-b svg{width:28px;height:28px}
#hpBox video.rem{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;display:none}
#hpBox.vid video.rem{display:block}
#hpBox video.loc{position:absolute;right:14px;top:calc(env(safe-area-inset-top,0px) + 60px);width:28vw;max-width:150px;aspect-ratio:3/4;object-fit:cover;border-radius:14px;border:2px solid rgba(255,255,255,.6);background:#000;display:none;transform:scaleX(-1);z-index:2}
#hpBox video.loc.back{transform:none}
#hpBox.myvid video.loc{display:block}
#hpBox.vid .hp-av{display:none}
#hpBox.vid .hp-mid{justify-content:flex-end}
#hpBox.vid .hp-mid > *:not(video){position:relative;z-index:1;text-shadow:0 1px 6px rgba(0,0,0,.6)}
#hpBox.vid .hp-bot,#hpBox.vid .hp-top{position:relative;z-index:1}
#hpToast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:2147483001;background:#1C0B30;color:#fff;padding:10px 16px;border-radius:12px;font-size:.86rem;font-weight:600;display:none;max-width:90vw;text-align:center}
#hpToast.on{display:block}
@media (prefers-reduced-motion:reduce){ #hpBox.ring .hp-av{animation:none} }
/* the floating Hub Phone button (above the Emergency button) + quick dial */
#hpFab{position:fixed;z-index:61;right:96px;top:calc(55% - 92px);height:66px;min-width:66px;border-radius:33px;border:0;cursor:pointer;display:none;align-items:center;justify-content:center;gap:10px;
  background:linear-gradient(145deg,#34C77E,#1E9E5E);color:#fff;box-shadow:0 8px 22px rgba(30,158,94,.38);font:inherit;transition:transform .15s,top .25s,bottom .25s}
#hpFab.on{display:flex}
#hpFab.solo{top:55%}
#hpFab::after{content:"";position:absolute;inset:-7px;border-radius:40px;border:2px solid rgba(46,184,114,.35);pointer-events:none}
#hpFab:hover{transform:scale(1.05)}
#hpFab > svg{width:30px;height:30px}
#hpFab .bd{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;border-radius:11px;background:#E5484D;color:#fff;font-size:.74rem;font-weight:800;display:none;place-items:center;border:2px solid #fff;padding:0 4px}
#hpFab .bd.on{display:grid}
#hpFab .lb{position:absolute;right:calc(100% + 12px);top:50%;transform:translateY(-50%);background:#1E9E5E;color:#fff;font-weight:800;font-size:.8rem;padding:6px 11px;border-radius:9px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s;text-align:left}
#hpFab .lb small{display:block;font-weight:600;opacity:.85;font-size:.7rem}
#hpFab:hover .lb{opacity:1}
#hpFab.ring{animation:hpShake .9s ease-in-out infinite;box-shadow:0 0 0 10px rgba(46,184,114,.22),0 0 0 22px rgba(46,184,114,.1),0 8px 22px rgba(30,158,94,.38)}
@keyframes hpShake{0%,100%{transform:rotate(0)}15%{transform:rotate(-14deg)}30%{transform:rotate(12deg)}45%{transform:rotate(-10deg)}60%{transform:rotate(8deg)}75%{transform:rotate(0)}}
#hpFab.call{padding:0 8px 0 18px;font-weight:800;font-size:.9rem;height:52px}
#hpFab.call::after{display:none}
#hpFab.call .nm{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hpFab.call .x{width:38px;height:38px;border-radius:50%;background:#E5484D;display:grid;place-items:center}
#hpFab.call .x svg{width:18px;height:18px}
#hpQd{position:fixed;z-index:62;width:250px;background:var(--surface,#fff);color:var(--text,#221A2E);border:1px solid var(--line,#E3DCEC);border-radius:18px;box-shadow:0 18px 50px rgba(42,15,69,.28);padding:12px;display:none;font-size:.82rem;max-height:calc(100dvh - 24px);overflow:auto}
#hpQd.on{display:block}
#hpQd .qhd{display:flex;align-items:center;gap:8px;font-weight:800;margin-bottom:4px}
#hpQd .qhd span{font-size:.7rem;color:#1E9E5E;background:rgba(46,184,114,.13);padding:2px 8px;border-radius:999px}
#hpQd .qhd button{margin-left:auto;color:var(--muted,#6D6479);font-size:1rem;background:none;border:0;cursor:pointer;width:28px;height:28px;border-radius:8px}
#hpQd .qds{text-align:center;font-size:1.5rem;font-weight:800;letter-spacing:.12em;height:34px;line-height:34px;font-variant-numeric:tabular-nums}
#hpQd .qds:empty::before{content:"Extension";font-size:.85rem;letter-spacing:0;font-weight:600;color:var(--muted,#6D6479)}
#hpQd .qmt{text-align:center;font-size:.74rem;color:var(--muted,#6D6479);min-height:1.2em;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hpQd .qmt b{color:var(--text,#221A2E)}
#hpQd .qkp{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
#hpQd .qkp button{height:38px;border-radius:10px;background:var(--paper,#F6F4F9);border:0;font:inherit;font-weight:700;font-size:1.05rem;color:inherit;cursor:pointer}
#hpQd .qkp button:active{transform:scale(.96)}
#hpQd .qcl{display:flex;gap:10px;justify-content:center;margin-bottom:10px}
#hpQd .qcl button{width:42px;height:42px;border-radius:50%;border:0;display:grid;place-items:center;color:#fff;background:#2EB872;cursor:pointer}
#hpQd .qcl button.v{background:#4A1F73}
#hpQd .qcl button[disabled]{opacity:.35;cursor:default}
#hpQd .qcl svg{width:19px;height:19px}
#hpQd .qsc{font-size:.64rem;font-weight:800;letter-spacing:.08em;color:var(--muted,#6D6479);margin:8px 0 2px;text-transform:uppercase}
#hpQd .qpr{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line,#EEE9F3)}
#hpQd .qav{width:28px;height:28px;border-radius:50%;background:#C8A24A;color:#2A0F45;font-size:.66rem;font-weight:800;display:grid;place-items:center;position:relative;flex:none}
#hpQd .qav u{position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;background:#2EB872;border:1.5px solid var(--surface,#fff)}
#hpQd .qtx{flex:1;min-width:0;line-height:1.2}
#hpQd .qtx b{display:block;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hpQd .qtx small{font-size:.7rem;color:var(--muted,#6D6479)}
#hpQd .qtx small.m{color:#E5484D;font-weight:700}
#hpQd .qpr button{width:30px;height:30px;border-radius:50%;border:0;background:#2EB872;color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}
#hpQd .qpr button svg{width:14px;height:14px}
#hpQd .qnt{font-size:.74rem;color:var(--muted,#6D6479);padding:4px 0}
#hpQd .qop{display:block;width:100%;text-align:center;margin-top:8px;color:var(--brand-2,#7B4BB0);font-weight:800;font-size:.8rem;background:none;border:0;cursor:pointer;padding:6px}
@media (max-width:1500px){ #hpFab{right:22px} }
@media (max-width:900px){ #hpFab{top:auto!important;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + var(--hpb,18px));height:56px;min-width:56px} #hpFab > svg{width:26px;height:26px} #hpFab .lb{display:none} #hpFab.call{height:48px}
  #hpFab.intool:not(.call){bottom:auto;top:58%!important;right:10px;height:46px;min-width:46px;opacity:.92} #hpFab.intool:not(.call) > svg{width:22px;height:22px} #hpFab.intool::after{inset:-4px} }
@media (prefers-reduced-motion:reduce){ #hpFab.ring{animation:none} }
@media print{ #hpFab,#hpQd{display:none!important} }`;
  document.head.append(css);
  const box = document.createElement("div"); box.id = "hpBox"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  const tst = document.createElement("div"); tst.id = "hpToast";
  const remAudio = document.createElement("audio"); remAudio.autoplay = true; remAudio.setAttribute("playsinline", "");
  document.body.append(box, tst, remAudio);
  let tstT = 0; const toast = m => { tst.textContent = m; tst.classList.add("on"); clearTimeout(tstT); tstT = setTimeout(() => tst.classList.remove("on"), 4200); };

  const I = {
    phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
    end: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3l-2-3H9L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2"/><path d="M14 9.5V11h-1.5M10 16.5V15h1.5"/></svg>'
  };

  /* ---------- WebSocket ---------- */
  function connect(){
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/phone/ws?dev=${DEV}`); } catch { return retry(); }
    ws.onopen = () => { wsOk = true; backoff = 1000; if (VIEW) send({ type: "viewing", c: VIEW }); emit(); clearInterval(pingT); pingT = setInterval(() => send({ type: "ping" }), 25000); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => { wsOk = false; clearInterval(pingT); emit(); retry(); };
    ws.onerror = () => {};
  }
  let retryT = 0;
  function retry(){ clearTimeout(retryT); retryT = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); }
  const send = o => { if (ws && ws.readyState === 1){ ws.send(JSON.stringify(o)); return true; } return false; };
  document.addEventListener("visibilitychange", () => { if (!document.hidden){ backoff = 1000; connect(); } });
  addEventListener("online", () => { backoff = 1000; connect(); });

  async function iceServers(){
    if (ICE && Date.now() - ICE_AT < 3600e3) return ICE;
    try { const r = await api("phone/ice"); ICE = r.iceServers; ICE_AT = Date.now(); } catch { ICE = [{ urls: "stun:stun.cloudflare.com:3478" }]; }
    return ICE;
  }

  /* ---------- messages ---------- */
  /* Hub Chat: live chat events go to the Hub Phone page (and refresh the unread count on the button) */
  const chatL = new Set(); let VIEW = "", unreadT = 0, UNREAD = 0;
  function onChat(m){
    chatL.forEach(f => { try { f(m); } catch {} });
    if (m.ev === "msg" || m.ev === "read" || m.ev === "conv"){ clearTimeout(unreadT); unreadT = setTimeout(loadUnread, 1200); }
  }
  async function loadUnread(){ if (!allowed || (HUBX.can && !HUBX.can("chat"))) return; try { UNREAD = (await api("chat/unread")).unread; if (fab) fab.dataset.k = ""; paintFab(); } catch {} }
  function viewing(c){ VIEW = c || ""; send({ type: "viewing", c: VIEW }); }
  function onMsg(m){
    if (m.type === "chat") return onChat(m);
    if (m.type === "ring") return incoming(m);
    if (ringing && m.callId === ringing.callId && (m.type === "cancel" || m.type === "taken")){
      toneOff(); const who = ringing.fromName; ringing = null; hide();
      if (m.type === "cancel"){ toast(`Missed call from ${who}`); setTimeout(loadRec, 800); }
      emit(); return;
    }
    if (!C || m.callId !== C.id) return;
    if (m.type === "calling"){ C.online = m.online; paintStatus(m.online ? "Calling…" : "Calling… (sending a notification)"); return; }
    if (m.type === "ringing"){ paintStatus("Ringing…"); return; }
    if (m.type === "pushed"){ paintStatus(m.devices ? "Ringing on their phone…" : "Calling… (the hub is closed on their side)"); return; }
    if (m.type === "busy"){ finish("On another call", true); return; }
    if (m.type === "unavailable"){ finish(m.why || "Not available", true); return; }
    if (m.type === "decline"){ finish("Declined", true); return; }
    if (m.type === "gone"){ finish("Call ended", true); return; }
    if (m.type === "accept"){ C.state = "connecting"; paintStatus("Connecting…"); toneOff(); clearTimeout(C.noAnswerT); startPeer(); emit(); return; }
    if (m.type === "sdp") return onSdp(m.sdp);
    if (m.type === "ice") return onIce(m.cand);
    if (m.type === "cam"){ C.peerCam = m.on; paintVideo(); return; }
    if (m.type === "mic"){ C.peerMic = m.on; paintStatus(); return; }
    if (m.type === "end"){ finish("Call ended", false); return; }
  }

  /* ---------- outgoing ---------- */
  async function call(email, video, name){
    if (C || ringing) return toast("You are already on a call");
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast("This browser cannot make calls — use Chrome, Edge or Safari");
    connect();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: "user", width: { ideal: 1280 } } : false }); }
    catch (e){ return toast(video ? "Allow the camera and the microphone for the hub to make a video call" : "Allow the microphone for the hub to make a call"); }
    C = { id: rid(), role: "caller", peer: String(email).toLowerCase(), peerName: name || email, video: !!video, state: "calling", local: stream, polite: false, peerCam: !!video, peerMic: true, mic: true, cam: !!video, facing: "user", q: [] };
    show(); paintStatus("Calling…"); toneOn("out"); emit();
    const go = () => send({ type: "ring", to: C.peer, callId: C.id, video: C.video });
    if (!go()){ let n = 0; const t = setInterval(() => { if (!C){ clearInterval(t); return; } if (go() || ++n > 20){ clearInterval(t); if (n > 20) finish("No connection to the hub", true); } }, 300); }
    C.noAnswerT = setTimeout(() => { if (C && C.state === "calling"){ send({ type: "cancel", callId: C.id }); finish("No answer", true); } }, 40000);
  }

  /* ---------- incoming ---------- */
  function incoming(m){
    if (C || (ringing && ringing.callId !== m.callId)){ return; }   // the other side hears "ringing" until it times out — the second call is logged as missed
    if (ringing) return;
    ringing = m; emit();
    send({ type: "ringing", callId: m.callId, visible: !document.hidden });
    box.className = "on ring";
    box.innerHTML = `<div class="hp-top"><span>${m.video ? "🎥 HUB VIDEO CALL" : "📞 HUB CALL"}</span><span></span></div>
      <div class="hp-mid"><div class="hp-av">${esc(ini(m.fromName))}</div><h2>${esc(m.fromName)}</h2><div class="hp-sub">${m.fromExt ? "Ext " + esc(m.fromExt) : ""}</div><div class="hp-st">${m.video ? "Incoming video call…" : "Incoming call…"}</div></div>
      <div class="hp-bot"><button class="hp-b red" id="hpNo" type="button"><i>${I.end}</i>Decline</button>
        ${m.video ? `<button class="hp-b green" id="hpVoice" type="button"><i>${I.phone}</i>Voice only</button>` : ""}
        <button class="hp-b green" id="hpYes" type="button"><i>${m.video ? I.cam : I.phone}</i>Answer</button></div>`;
    toneOn("in");
    if (document.hidden && "Notification" in window && Notification.permission === "granted" && navigator.serviceWorker)
      navigator.serviceWorker.ready.then(r => r.showNotification(m.video ? "🎥 Incoming video call" : "📞 Incoming call", { body: `${m.fromName} is calling you`, tag: "call-" + m.callId, icon: "/icons/abc-192.png", requireInteraction: true, data: { url: "/" } })).catch(() => {});
    box.querySelector("#hpNo").onclick = () => { send({ type: "decline", callId: m.callId }); toneOff(); ringing = null; hide(); emit(); };
    box.querySelector("#hpYes").onclick = () => answer(m, m.video);
    const v = box.querySelector("#hpVoice"); if (v) v.onclick = () => answer(m, false);
    /* the visible flag: if the person comes back to the tab while it rings */
    const vis = () => { if (ringing === m && !document.hidden) send({ type: "ringing", callId: m.callId, visible: true }); };
    document.addEventListener("visibilitychange", vis, { once: true });
  }
  async function answer(m, video){
    toneOff(); unlock();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: "user", width: { ideal: 1280 } } : false }); }
    catch { try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); video = false; } catch { toast("Allow the microphone for the hub to answer"); return; } }
    ringing = null;
    C = { id: m.callId, role: "callee", peer: m.from, peerName: m.fromName, video: !!m.video, state: "connecting", local: stream, polite: true, peerCam: !!m.video, peerMic: true, mic: true, cam: !!video, facing: "user", q: [] };
    if (!send({ type: "accept", callId: m.callId })){ finish("No connection to the hub", true); return; }
    show(); paintStatus("Connecting…"); emit();
    [1500, 4000].forEach(t => setTimeout(() => closeNotes(m.callId), t));   // the ringing notification on this device
    await makePeer();
  }

  /* ---------- WebRTC ---------- */
  async function makePeer(){
    if (C.pc) return C.pc;
    const pc = C.pc = new RTCPeerConnection({ iceServers: await iceServers() });
    C.making = false; C.ignore = false;
    C.remote = new MediaStream();
    pc.ontrack = ev => { if (!C) return; C.remote.addTrack(ev.track); remAudio.srcObject = C.remote; const rv = box.querySelector("video.rem"); if (rv) rv.srcObject = C.remote;
      remAudio.play().catch(() => {}); ev.track.onunmute = paintVideo; ev.track.onmute = paintVideo; paintVideo(); };
    pc.onicecandidate = ev => { if (ev.candidate && C) send({ type: "ice", callId: C.id, cand: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }); };
    pc.onnegotiationneeded = async () => {
      try { C.making = true; const o = await pc.createOffer(); if (pc.signalingState !== "stable") return; await pc.setLocalDescription(o);
        send({ type: "sdp", callId: C.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      catch {} finally { if (C) C.making = false; }
    };
    pc.onconnectionstatechange = () => {
      if (!C || C.pc !== pc) return;
      const s = pc.connectionState;
      if (s === "connected"){ if (C.state !== "live"){ C.state = "live"; C.t0 = Date.now(); blip(); tick(); emit(); } paintStatus(); }
      else if (s === "disconnected") paintStatus("Reconnecting…");
      else if (s === "failed"){ send({ type: "end", callId: C.id }); finish(ICE_TURN_HINT, true); }
    };
    return pc;
  }
  const ICE_TURN_HINT = "The call could not connect — the two networks block each other";
  function addLocal(pc){ C.local.getTracks().forEach(t => { if (!pc.getSenders().some(s => s.track === t)) pc.addTrack(t, C.local); }); }
  async function startPeer(){ const pc = await makePeer(); addLocal(pc); }   // caller: adding the tracks starts the offer
  async function onSdp(desc){
    if (!C) return;
    const pc = await makePeer();
    const collision = desc.type === "offer" && (C.making || pc.signalingState !== "stable");
    C.ignore = !C.polite && collision; if (C.ignore) return;
    try {
      if (collision) await Promise.all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(desc)]);
      else await pc.setRemoteDescription(desc);
      for (const c of C.q.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (desc.type === "offer"){
        addLocal(pc);
        const a = await pc.createAnswer(); await pc.setLocalDescription(a);
        send({ type: "sdp", callId: C.id, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
    } catch (e){ console.warn("[HubPhone] sdp", e); }
  }
  async function onIce(cand){
    if (!C || !cand) return;
    if (!C.pc || !C.pc.remoteDescription){ C.q.push(cand); return; }
    try { await C.pc.addIceCandidate(cand); } catch (e){ if (!C.ignore) console.warn("[HubPhone] ice", e); }
  }

  /* ---------- in-call controls ---------- */
  function toggleMic(){ if (!C) return; C.mic = !C.mic; C.local.getAudioTracks().forEach(t => t.enabled = C.mic); send({ type: "mic", callId: C.id, on: C.mic }); paintCtl(); }
  async function toggleCam(){
    if (!C) return;
    let t = C.local.getVideoTracks()[0];
    if (!t){
      try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: C.facing, width: { ideal: 1280 } } }); t = s.getVideoTracks()[0]; C.local.addTrack(t);
        if (C.pc) C.pc.addTrack(t, C.local); C.cam = true; }
      catch { return toast("Allow the camera for the hub"); }
    } else { C.cam = !C.cam; t.enabled = C.cam; }
    send({ type: "cam", callId: C.id, on: C.cam }); paintVideo(); paintCtl();
  }
  async function flip(){
    if (!C) return; const old = C.local.getVideoTracks()[0]; if (!old) return;
    const facing = C.facing === "user" ? "environment" : "user";
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } } }); const t = s.getVideoTracks()[0];
      const snd = C.pc && C.pc.getSenders().find(x => x.track === old); if (snd) await snd.replaceTrack(t);
      C.local.removeTrack(old); old.stop(); C.local.addTrack(t); C.facing = facing; paintVideo(); }
    catch { toast("This device has one camera"); }
  }
  function hangup(){
    if (!C) return;
    send({ type: C.state === "calling" ? "cancel" : "end", callId: C.id });
    finish("Call ended", false);
  }

  /* ---------- painting ---------- */
  function show(){
    box.className = "on";
    box.innerHTML = `<video class="rem" autoplay playsinline></video><video class="loc" autoplay playsinline muted></video>
      <div class="hp-top"><span>${C.video ? "🎥 HUB VIDEO CALL" : "📞 HUB CALL"}</span><button type="button" id="hpMin">▾ Minimise</button></div>
      <div class="hp-mid"><div class="hp-av">${esc(ini(C.peerName))}</div><h2>${esc(C.peerName)}</h2><div class="hp-st" id="hpSt"></div></div>
      <div class="hp-bot"><button class="hp-b" id="hpMic" type="button"><i>${I.mic}</i><span>Mute</span></button>
        <button class="hp-b" id="hpCam" type="button"><i>${I.cam}</i><span>Camera</span></button>
        <button class="hp-b" id="hpFlip" type="button"><i>${I.flip}</i><span>Flip</span></button>
        <button class="hp-b red" id="hpEnd" type="button"><i>${I.end}</i><span>End</span></button></div>`;
    box.querySelector("#hpMin").onclick = minimise;
    box.querySelector("#hpMic").onclick = toggleMic;
    box.querySelector("#hpCam").onclick = toggleCam;
    box.querySelector("#hpFlip").onclick = flip;
    box.querySelector("#hpEnd").onclick = hangup;
    const lv = box.querySelector("video.loc"); lv.srcObject = C.local;
    if (C.remote) box.querySelector("video.rem").srcObject = C.remote;
    C.min = false; paintFab();
    paintVideo(); paintCtl();
  }
  function minimise(){ if (!C) return; box.classList.remove("on"); C.min = true; paintFab(); }
  function restore(){ if (C){ box.classList.add("on"); C.min = false; paintFab(); } }
  function paintCtl(){
    if (!C) return;
    const m = box.querySelector("#hpMic"), c = box.querySelector("#hpCam"), f = box.querySelector("#hpFlip");
    if (m){ m.classList.toggle("off", !C.mic); m.querySelector("span").textContent = C.mic ? "Mute" : "Unmute"; }
    if (c){ c.classList.toggle("off", C.cam); c.querySelector("span").textContent = C.cam ? "Camera off" : "Camera"; }
    if (f) f.style.display = C.cam ? "" : "none";
  }
  function paintVideo(){
    if (!C) return;
    const peerVid = C.remote && C.remote.getVideoTracks().some(t => t.readyState === "live" && !t.muted) && C.peerCam !== false;
    box.classList.toggle("vid", !!peerVid);
    box.classList.toggle("myvid", !!C.cam && C.local.getVideoTracks().length > 0);
    const lv = box.querySelector("video.loc"); if (lv) lv.classList.toggle("back", C.facing === "environment");
  }
  const mmss = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  function paintStatus(text){
    if (!C) return;
    if (text) C.status = text;
    const el = box.querySelector("#hpSt");
    const t = C.state === "live" && C.pc && C.pc.connectionState === "connected" ? mmss(Math.round((Date.now() - C.t0) / 1000)) + (C.peerMic === false ? " · they are muted" : "") : C.status || "";
    if (el) el.textContent = t;
    paintFab();
  }
  let tickT = 0; function tick(){ clearInterval(tickT); tickT = setInterval(() => { if (!C){ clearInterval(tickT); return; } paintStatus(); }, 1000); }
  function hide(){ box.className = ""; box.innerHTML = ""; paintFab(); }
  function finish(msg, showIt){
    toneOff(); clearInterval(tickT);
    if (C){ clearTimeout(C.noAnswerT); try { C.pc && C.pc.close(); } catch {} C.local && C.local.getTracks().forEach(t => t.stop()); }
    const was = C; C = null; remAudio.srcObject = null;
    if (showIt && was){ const st = box.querySelector("#hpSt"); if (st) st.textContent = msg; setTimeout(() => { if (!C && !ringing) hide(); }, 1800); }
    else { hide(); if (was && was.t0) toast(`Call ended · ${mmss(Math.round((Date.now() - was.t0) / 1000))}`); }
    emit();
  }
  addEventListener("pagehide", () => { if (C) send({ type: C.state === "calling" ? "cancel" : "end", callId: C.id }); });

  /* ---------- the floating Hub Phone button + quick dial (Oct 2026) ----------
     Above the Emergency button (in its place when it is not shown), on every screen of the hub.
     Missed calls → red count · ringing → shakes · minimised call → "Name · 03:12" with a red End button */
  function closeNotes(id){ try { navigator.serviceWorker && navigator.serviceWorker.ready.then(r => r.getNotifications({ tag: "call-" + id })).then(ns => (ns || []).forEach(n => n.close())).catch(() => {}); } catch {} }
  var fab = null, qd = null, BOOK = null, BOOK_AT = 0, REC = null, DIAL = "", allowed = false, qdMissed = 0;
  const favs = () => { try { return JSON.parse(localStorage.getItem("hub.phoneFav") || "[]"); } catch { return []; } };
  const icoCall = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';
  function makeFab(){
    fab = document.createElement("button"); fab.id = "hpFab"; fab.type = "button"; fab.setAttribute("aria-label", "Hub Phone");
    qd = document.createElement("div"); qd.id = "hpQd"; qd.setAttribute("role", "dialog"); qd.setAttribute("aria-label", "Quick dial");
    document.body.append(fab, qd);
    fab.onclick = ev => {
      if (C && C.min){ if (ev.target.closest(".x")) hangup(); else restore(); return; }
      if (C){ restore(); return; }
      qd.classList.contains("on") ? qdClose() : qdOpen();
    };
    document.addEventListener("pointerdown", ev => { if (qd.classList.contains("on") && !qd.contains(ev.target) && !fab.contains(ev.target)) qdClose(); }, true);
    addEventListener("keydown", ev => {
      if (!qd.classList.contains("on")) return;
      if (ev.key === "Escape") return qdClose();
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (/^[0-9]$/.test(ev.key)){ if (DIAL.length < 4) DIAL += ev.key; paintQd(); }
      else if (ev.key === "Backspace"){ DIAL = DIAL.slice(0, -1); paintQd(); }
      else if (ev.key === "Enter"){ const p = match(); if (p) dialP(p, false); }
    });
    setInterval(() => { place(); if (C && C.min) paintFab(); }, 1000);
    addEventListener("resize", () => { place(); if (qd.classList.contains("on")) placeQd(); });
    addEventListener("hashchange", () => { qdClose(); paintFab(); });
    loadRec(); loadUnread(); setInterval(() => { if (!document.hidden){ loadRec(); loadUnread(); } }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden){ loadRec(); loadUnread(); } });
    paintFab();
  }
  const vis = el => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  function place(){
    if (!fab) return;
    const emg = document.getElementById("emgFab"), abx = document.getElementById("sanadFab");
    fab.classList.toggle("solo", !vis(emg));
    fab.classList.toggle("intool", /^#\/app\//.test(location.hash));   // phones: inside a tool it moves to the side, clear of the tool's bottom buttons
    /* phone screen: stacked bottom right above ABCON and Emergency */
    fab.style.setProperty("--hpb", (vis(abx) ? 166 : vis(emg) ? 92 : 18) + "px");
  }
  function paintFab(){
    if (!fab) return;
    const own = /^#\/app\/(phone|chat)(\b|\/|$)/.test(location.hash);   // not over Hub Phone / Hub Chat itself
    fab.classList.toggle("on", allowed && !(C && !C.min) && !(own && !(C && C.min)));
    fab.classList.toggle("ring", !!ringing);
    if (C && C.min){
      fab.className = "on call";
      const t = C.state === "live" && C.t0 ? mmss(Math.round((Date.now() - C.t0) / 1000)) : (C.status || "Calling…");
      fab.innerHTML = `<span class="nm">${esc(String(C.peerName).split(" ")[0])} · ${esc(t)}</span><span class="x" title="End the call">${I.end}</span>`;
      fab.title = "Tap to return to the call"; fab.dataset.k = "";
      place(); return;
    }
    fab.classList.remove("call"); fab.title = "";
    const mc = REC ? REC.missed : 0, n = mc + UNREAD, ext = BOOK && BOOK.me.ext ? "ext " + BOOK.me.ext : "Hub Phone";
    if (!fab.dataset.k || fab.dataset.k !== n + ext + UNREAD){
      fab.dataset.k = n + ext + UNREAD;
      fab.innerHTML = `${icoCall}<span class="bd ${n ? "on" : ""}">${n > 9 ? "9+" : n}</span><span class="lb">Hub Phone<small>${esc(ext)}${mc ? ` · ${mc} missed` : ""}${UNREAD ? ` · ${UNREAD} unread` : ""}</small></span>`;
    }
    place();
  }
  async function loadBook(force){
    if (!force && BOOK && Date.now() - BOOK_AT < 60000) return BOOK;
    try { BOOK = await api("phone/book"); BOOK_AT = Date.now(); } catch {}
    return BOOK;
  }
  async function loadRec(){ if (!allowed) return; try { REC = await api("phone/recent"); if (fab) fab.dataset.k = ""; paintFab(); if (qd && qd.classList.contains("on")) paintQd(); } catch {} }
  const byE = e => BOOK && BOOK.people.find(p => p.email === e);
  const match = () => DIAL && BOOK ? BOOK.people.find(p => p.ext === DIAL) : null;
  function dialP(p, video){
    if (!p) return;
    if (BOOK && p.email === BOOK.me.email) return toast("That is your own extension");
    qdClose(); DIAL = ""; call(p.email, video, p.name);
  }
  function placeQd(){
    const r = fab.getBoundingClientRect(), w = qd.offsetWidth, h = qd.offsetHeight, m = innerWidth <= 900;
    if (m){ qd.style.right = "12px"; qd.style.left = "auto"; qd.style.top = "auto"; qd.style.bottom = Math.max(12, innerHeight - r.top + 12) + "px"; return; }
    qd.style.bottom = "auto"; qd.style.right = "auto";
    qd.style.left = Math.max(12, r.left - w - 16) + "px";
    qd.style.top = Math.min(Math.max(12, r.top + r.height / 2 - h / 2), innerHeight - h - 12) + "px";
  }
  async function qdOpen(){
    unlock(); DIAL = ""; qd.classList.add("on"); paintQd(); placeQd();
    await Promise.all([loadBook(), loadRec()]); qdMissed = REC ? REC.missed : 0; paintQd(); placeQd();
    if (qdMissed) setTimeout(() => api("phone/seen", {}).then(() => { if (REC) REC.missed = 0; fab.dataset.k = ""; paintFab(); }).catch(() => {}), 1500);
  }
  function qdClose(){ qd.classList.remove("on"); }
  const tm = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });
  function paintQd(){
    const p = match(), me = BOOK ? BOOK.me : null;
    const prow = (x, sub, cls) => `<div class="qpr"><span class="qav">${esc(ini(x.name))}${x.online ? "<u></u>" : ""}</span><span class="qtx"><b>${esc(x.name)}${x.ext ? " · " + esc(x.ext) : ""}</b><small class="${cls || ""}">${esc(sub)}</small></span><button type="button" data-e="${esc(x.email)}" title="Call">${icoCall}</button></div>`;
    const calls = REC ? REC.calls : [];
    const missed = calls.filter(c => !c.out && c.status === "missed").slice(0, Math.min(3, qdMissed));
    const list = missed.length ? missed : calls.slice(0, 3);
    const recRows = list.map(c => { const x = byE(c.peer) || { email: c.peer, name: c.peerName || c.peer, ext: "" };
      const miss = !c.out && c.status === "missed";
      return prow(x, (miss ? "Missed · " : c.out ? "↗ " : "↙ ") + tm(c.at), miss ? "m" : ""); }).join("");
    const F = favs().map(byE).filter(Boolean).slice(0, 4);
    qd.innerHTML = `<div class="qhd">Quick dial ${me && me.ext ? `<span>ext ${esc(me.ext)}</span>` : ""}<button type="button" data-x title="Close">✕</button></div>
      <div class="qds">${esc(DIAL)}</div><div class="qmt">${p ? `<b>${esc(p.name)}</b> · ${esc(p.position || "")}${p.online ? " · online" : ""}` : DIAL ? (BOOK ? "No one has this extension" : "Loading…") : ""}</div>
      <div class="qkp">${["1","2","3","4","5","6","7","8","9","*","0","⌫"].map(k => `<button type="button" data-k="${k}">${k}</button>`).join("")}</div>
      <div class="qcl"><button type="button" class="v" data-call="v" title="Video call" ${p ? "" : "disabled"}>${I.cam}</button><button type="button" data-call="a" title="Call" ${p ? "" : "disabled"}>${icoCall}</button></div>
      ${list.length ? `<div class="qsc">${missed.length ? "Missed · " + missed.length : "Recent"}</div>${recRows}` : ""}
      <div class="qsc">Favourites</div>${F.map(x => prow(x, (x.siteName || x.position || "") + (x.online ? " · online" : ""))).join("") || `<div class="qnt">Tap ☆ next to a person in Hub Phone to add favourites.</div>`}
      ${UNREAD ? `<button type="button" class="qop" data-chats style="margin-top:6px;background:rgba(46,184,114,.12);border-radius:10px;color:#1E9E5E">💬 ${UNREAD} unread message${UNREAD > 1 ? "s" : ""} · Open chats</button>` : ""}
      <button type="button" class="qop" data-open>Open Hub Phone ›</button>`;
    qd.querySelector("[data-x]").onclick = qdClose;
    qd.querySelector("[data-open]").onclick = () => { qdClose(); window.HUBX && HUBX.open("phone"); };
    const oc = qd.querySelector("[data-chats]"); if (oc) oc.onclick = () => { qdClose(); window.HUBX && HUBX.open(HUBX.can("chat") ? "chat" : "phone"); };
    qd.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { const k = b.dataset.k;
      if (k === "⌫") DIAL = DIAL.slice(0, -1); else if (/^[0-9]$/.test(k) && DIAL.length < 4) DIAL += k; paintQd(); });
    qd.querySelectorAll("[data-call]").forEach(b => b.onclick = () => dialP(match(), b.dataset.call === "v"));
    qd.querySelectorAll(".qpr [data-e]").forEach(b => b.onclick = () => dialP(byE(b.dataset.e) || { email: b.dataset.e, name: b.dataset.e }, false));
  }

  window.HubPhone = { call, state, on: f => { listeners.add(f); return () => listeners.delete(f); }, dev: DEV, refresh: () => { loadRec(); loadUnread(); }, onChat: f => { chatL.add(f); return () => chatL.delete(f); }, viewing };

  /* start once the hub is signed in and Hub Phone is open to this person */
  (function boot(n){
    if (!window.HUBX || !HUBX.me()){ if (n < 600) setTimeout(() => boot(n + 1), 500); return; }
    if (HUBX.can && !HUBX.can("phone")) return;
    allowed = true; makeFab(); loadBook().then(() => { if (fab) fab.dataset.k = ""; paintFab(); });
    connect();
    /* opened from a chat notification: /?chat=<id> → Hub Chat on that chat */
    try { const q = new URLSearchParams(location.search), c = q.get("chat");
      if (c){ q.delete("chat"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
        setTimeout(() => HUBX.deep && HUBX.deep(HUBX.can("chat") ? "chat" : "phone", (HUBX.can("chat") ? "" : "&tab=chats") + "&c=" + encodeURIComponent(c)), 600); } } catch {}
  })(0);
})();

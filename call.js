/* ============================================================
   📞 RZ-Chat — تماس صوتی و تصویری (فاز ۱) — فایل جدید
   ============================================================
   این فایل فقط «اضافه» شده است؛ هیچ فایل دیگری تغییر نمی‌کند
   و هیچ چیزی از فایل‌های قبلی کم نمی‌شود.

   - اتصال صدا/تصویر: WebRTC مستقیم بین دو نفر (P2P)
   - زنگ خوردن و رد و بدل کردن اطلاعات: Supabase Realtime Broadcast
   - سرور رایگان STUN گوگل برای پشت NAT بودن
   - تمام ظاهر تماس از همین فایل تزریق می‌شود
   ============================================================ */

import { sb, getMyId, getMe, getUserInfo } from './auth.js';

/* ---------------- تنظیمات ---------------- */

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const RING_TIMEOUT_MS = 45000; /* اگر تا این وقت جواب نداد = بی‌پاسخ */
const INCOMING_MAX_MS = 60000; /* زنگ ورودی حداکثر این‌قدر می‌ماند */

const USER_CH = (uid) => 'rz-call-u-' + uid; /* صندوق ورودی هر کاربر */
const SESS_CH = (cid) => 'rz-call-s-' + cid; /* کانال مخصوص هر تماس */

/* ---------------- وضعیت ---------------- */

let myId = null;
let ready = false;

let state = 'idle'; /* idle | outgoing | incoming | active | ending */
let callId = null;
let kind = 'audio'; /* audio | video */
let chatPeer = null;        /* طرف چت فعلی (برای دکمه‌های هدر) */
let peerId = null;          /* طرف تماس جاری */
let peerInfo = null;
let chatIdForLog = null;    /* چت جاری برای ثبت لاگ تماس */
let isCaller = false;
let answered = false;
let incomingOffer = null;

let pc = null;
let localStream = null;
let remoteStream = null;
let inboxCh = null;
let sessCh = null;
let peerUserCh = null;

let pendingIce = [];
let iceReady = false;
let timerInt = null;
let timeoutT = null;
let startedAt = 0;

let ringOn = false;
let ringTimer = null;
let vibInt = null;
let audioCtx = null;
let ringMaster = null;

let incBuf = null; /* بافر تکه‌های SDP زنگ ورودی */
let ansBuf = null; /* بافر تکه‌های SDP جواب */

/* ---------------- ابزارهای کوچک ---------------- */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function sendOn(ch, ev, payload) {
  if (!ch) return Promise.resolve();
  return Promise.resolve()
    .then(() => ch.send({ type: 'broadcast', event: ev, payload }))
    .catch(() => {});
}

function chunkStr(s, n) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

/* SDP ممکنه بزرگ باشه؛ برای اطمینان تکه‌تکه می‌فرستیم */
async function sendSdp(ch, ev, base, sdp) {
  const parts = chunkStr(sdp || '', 1800);
  const meta = Object.assign({}, base, { sdpN: parts.length, sdpLen: (sdp || '').length });
  await sendOn(ch, ev, meta);
  for (let i = 0; i < parts.length; i++) {
    await sendOn(ch, ev + '-chunk', {
      callId: base.callId, i: i, n: parts.length, part: parts[i],
    });
  }
}

function openChannel(name, handlers) {
  return new Promise((resolve) => {
    const ch = sb.channel(name, { config: { broadcast: { self: false } } });
    const hs = handlers || {};
    Object.keys(hs).forEach((ev) => {
      ch.on('broadcast', { event: ev }, (msg) => {
        try { hs[ev]((msg || {}).payload || {}); }
        catch (e) { console.error('rz-call handler:', e); }
      });
    });
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') resolve(ch); });
    setTimeout(() => resolve(ch), 6000); /* فال‌بک اگر وضعیت دیر آمد */
  });
}

function validRing(p) {
  return !!p &&
    typeof p.callId === 'string' && p.callId.length > 3 && p.callId.length < 60 &&
    typeof p.sdp === 'string' && p.sdp.length > 20 && p.sdp.length < 60000 &&
    typeof p.from === 'string' && p.from.length > 3;
}

function permMsg(e) {
  const n = (e && e.name) || '';
  if (n === 'NO_SUPPORT' || !navigator.mediaDevices)
    return 'مرورگرت از تماس پشتیبانی نمی‌کند — کروم را به‌روز کن';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    const inApp = window.matchMedia('(display-mode: standalone)').matches;
    return 'اجازه میکروفون/دوربین داده نشد' +
      (inApp
        ? ' — فعلاً از کروم گوشی یا کامپیوتر تست کن (اپ را هم به‌زودی آپدیت می‌کنیم)'
        : ' — روی قفل کنار نوار آدرس بزن و اجازه بده');
  }
  if (n === 'NotFoundError') return 'میکروفون یا دوربین پیدا نشد';
  if (n === 'NotReadableError') return 'یه برنامه دیگه داره از میکروفون/دوربین استفاده می‌کنه';
  return 'دسترسی به میکروفون/دوربین ممکن نشد';
}

async function getMedia(k) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw Object.assign(new Error('no support'), { name: 'NO_SUPPORT' });
  const c = (k === 'video')
    ? { audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
    : { audio: true, video: false };
  try {
    return await navigator.mediaDevices.getUserMedia(c);
  } catch (e) {
    if (k === 'video' && (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')))
      return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    throw e;
  }
}

/* ---------------- زنگ و لرزش ---------------- */

function startRing(incoming) {
  stopRing();
  ringOn = true;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    ringMaster = audioCtx.createGain();
    ringMaster.gain.value = incoming ? 0.30 : 0.10;
    ringMaster.connect(audioCtx.destination);

    const beep = (at, freqs, dur) => {
      freqs.forEach((f) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(1, at + 0.02);
        g.gain.setValueAtTime(1, at + dur - 0.06);
        g.gain.linearRampToValueAtTime(0.0001, at + dur);
        o.connect(g); g.connect(ringMaster);
        o.start(at); o.stop(at + dur + 0.05);
      });
    };

    const loop = () => {
      if (!ringOn) return;
      const t = audioCtx.currentTime + 0.06;
      if (incoming) beep(t, [440, 480], 1.1);
      else beep(t, [425], 0.4);
      ringTimer = setTimeout(loop, incoming ? 2400 : 3200);
    };
    loop();
  } catch (e) { /* اگر صدا اجازه نشد، مهم نیست */ }

  if (incoming && navigator.vibrate) {
    const v = () => { try { navigator.vibrate([450, 250, 450]); } catch (e) {} };
    v();
    vibInt = setInterval(v, 1600);
  }
}

function stopRing() {
  ringOn = false;
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (vibInt) {
    clearInterval(vibInt); vibInt = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
  }
  if (ringMaster) { try { ringMaster.disconnect(); } catch (e) {} ringMaster = null; }
}

/* ---------------- ساخت رابط تماس ---------------- */

const UI = {};

function ensureUI() {
  if (UI.ov) return;

  const st = el('style', '', `
    #rz-call-ov{position:fixed;inset:0;z-index:100000;display:none;direction:rtl;
      font-family:tahoma;color:#fff;user-select:none;-webkit-user-select:none;
      background:linear-gradient(160deg,#062a3e 0%,#0a4a6e 55%,#0d6a9e 100%);}
    #rz-remote-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
      background:#000;display:none;}
    #rz-call-ov.video-mode #rz-remote-video{display:block;}
    #rz-local-video{position:absolute;bottom:110px;left:14px;width:110px;height:150px;
      object-fit:cover;border-radius:14px;background:#000;display:none;z-index:3;
      border:2px solid rgba(255,255,255,.25);transform:scaleX(-1);}
    #rz-call-ov.video-mode #rz-local-video{display:block;}
    .rz-call-card{position:absolute;top:0;right:0;left:0;padding:70px 20px 0;
      text-align:center;z-index:2;}
    #rz-call-ov.video-mode .rz-call-card{padding-top:40px;
      background:linear-gradient(180deg,rgba(0,0,0,.5),transparent);}
    .rz-call-ava{width:96px;height:96px;border-radius:50%;margin:0 auto 14px;
      background:linear-gradient(135deg,#22a5e0,#006daa);display:flex;align-items:center;
      justify-content:center;font-size:38px;font-weight:bold;overflow:hidden;
      border:3px solid rgba(255,255,255,.35);box-shadow:0 8px 30px rgba(0,0,0,.35);}
    .rz-call-ava img{width:100%;height:100%;object-fit:cover;}
    .rz-call-name{font-size:21px;font-weight:bold;text-shadow:0 2px 8px rgba(0,0,0,.4);}
    .rz-call-sub{margin-top:8px;font-size:13px;opacity:.92;min-height:18px;}
    .rz-call-timer{margin-top:4px;font-size:14px;opacity:.95;min-height:18px;}
    .rz-call-actions{position:absolute;bottom:calc(30px + env(safe-area-inset-bottom,0px));
      left:0;right:0;display:flex;justify-content:center;align-items:center;gap:26px;z-index:4;}
    .rz-cbtn{width:62px;height:62px;border-radius:50%;border:none;font-size:24px;
      cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;
      box-shadow:0 6px 20px rgba(0,0,0,.35);transition:transform .15s ease;}
    .rz-cbtn:active{transform:scale(.88);}
    .rz-cbtn.green{background:#22c55e;}
    .rz-cbtn.red{background:#ef4444;}
    .rz-cbtn.small{width:52px;height:52px;font-size:20px;background:rgba(255,255,255,.2);}
    .rz-cbtn.small.off{background:#ef4444;}
    .rz-call-hint{position:absolute;bottom:calc(112px + env(safe-area-inset-bottom,0px));
      left:16px;right:16px;text-align:center;font-size:11px;opacity:.75;z-index:4;}
    .rz-call-btn{padding:8px 12px !important;font-size:15px !important;line-height:1;}
  `);
  document.head.appendChild(st);

  const ov = el('div');
  ov.id = 'rz-call-ov';
  ov.innerHTML = `
    <video id="rz-remote-video" autoplay playsinline></video>
    <video id="rz-local-video" autoplay playsinline muted></video>
    <div class="rz-call-card">
      <div class="rz-call-ava" id="rz-call-ava">؟</div>
      <div class="rz-call-name" id="rz-call-name"></div>
      <div class="rz-call-sub" id="rz-call-sub"></div>
      <div class="rz-call-timer" id="rz-call-timer"></div>
    </div>
    <div class="rz-call-hint" id="rz-call-hint"></div>
    <div class="rz-call-actions" id="rz-call-actions"></div>`;
  document.body.appendChild(ov);

  UI.ov = ov;
  UI.ava = ov.querySelector('#rz-call-ava');
  UI.name = ov.querySelector('#rz-call-name');
  UI.sub = ov.querySelector('#rz-call-sub');
  UI.timer = ov.querySelector('#rz-call-timer');
  UI.hint = ov.querySelector('#rz-call-hint');
  UI.actions = ov.querySelector('#rz-call-actions');
  UI.remoteV = ov.querySelector('#rz-remote-video');
  UI.localV = ov.querySelector('#rz-local-video');
}

function mkBtn(cls, txt, fn) {
  const b = el('button', 'rz-cbtn ' + cls, txt);
  b.onclick = fn;
  return b;
}

function showActions(mode) {
  const a = UI.actions;
  a.innerHTML = '';

  if (mode === 'incoming') {
    a.appendChild(mkBtn('red', '✖', declineCall));
    a.appendChild(mkBtn('green', '📞', acceptCall));
    return;
  }

  const muteBtn = mkBtn('small', '🎤', () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    muteBtn.classList.toggle('off', !t.enabled);
    muteBtn.textContent = t.enabled ? '🎤' : '🔇';
  });
  a.appendChild(muteBtn);

  if (kind === 'video') {
    const camBtn = mkBtn('small', '🎥', () => {
      if (!localStream) return;
      const t = localStream.getVideoTracks()[0];
      if (!t) return;
      t.enabled = !t.enabled;
      camBtn.classList.toggle('off', !t.enabled);
      UI.localV.style.opacity = t.enabled ? '1' : '.15';
    });
    a.appendChild(camBtn);
  }

  a.appendChild(mkBtn('red', '📵', hangup));
}

function paintPeer() {
  if (!UI.name) return;
  UI.name.textContent = (peerInfo && peerInfo.name) || 'کاربر';
  if (peerInfo && peerInfo.photo) {
    UI.ava.innerHTML = '<img src="' + peerInfo.photo + '" alt="">';
  } else {
    UI.ava.textContent = ((peerInfo && peerInfo.name) || '؟').charAt(0);
  }
}

function showOverlay(video) {
  ensureUI();
  UI.ov.classList.toggle('video-mode', !!video);
  UI.ov.style.display = 'block';
  UI.timer.textContent = '';
  UI.hint.textContent = '';
}

function setStatus(t) { if (UI.sub) UI.sub.textContent = t; }

function attachLocalVideo() {
  if (kind === 'video' && UI.localV && localStream) {
    UI.localV.srcObject = localStream;
    if (UI.localV.play) UI.localV.play().catch(() => {});
  }
}

/* ---------------- شروع تماس (سمت تماس‌گیرنده) ---------------- */

async function startCall(k) {
  if (state !== 'idle' || !myId || !chatPeer) return;
  if (typeof RTCPeerConnection === 'undefined') {
    alert('مرورگرت از تماس پشتیبانی نمی‌کند');
    return;
  }

  kind = k;
  isCaller = true;
  answered = false;
  iceReady = false;
  pendingIce = [];
  incomingOffer = null;
  peerId = chatPeer;
  callId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  try {
    localStream = await getMedia(kind);
  } catch (e) {
    alert(permMsg(e));
    return;
  }

  state = 'outgoing';
  peerInfo = await getUserInfo(peerId);
  showOverlay(kind === 'video');
  paintPeer();
  setStatus('در حال زنگ زدن…');
  showActions('outgoing');
  attachLocalVideo();
  startRing(false);

  pc = buildPC();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  sessCh = await openChannel(SESS_CH(callId), {
    answer: onAnswerMeta,
    'answer-chunk': onAnswerChunk,
    ice: onIce,
    bye: () => endCall('done', 'تماس تمام شد'),
    decline: () => { logCall('📞 تماس رد شد'); endCall('declined', 'تماس رد شد'); },
    busy: () => { logCall('📞 تماس — خط مشغول'); endCall('busy', 'خط مشغول است'); },
  });

  peerUserCh = await openChannel(USER_CH(peerId), {});

  await sendSdp(peerUserCh, 'ring', {
    callId: callId,
    kind: kind,
    from: myId,
    name: (getMe() || {}).name || 'کاربر',
  }, pc.localDescription.sdp);

  timeoutT = setTimeout(() => {
    if (state === 'outgoing') {
      sendOn(peerUserCh, 'cancel', { callId: callId });
      logCall('📞 تماس بی‌پاسخ');
      endCall('missed', 'پاسخی نبود');
    }
  }, RING_TIMEOUT_MS);
}

/* ---------------- زنگ خوردن (سمت گیرنده) ---------------- */

function sendBusy(cid) {
  openChannel(SESS_CH(cid), {}).then((ch) => {
    sendOn(ch, 'busy', {});
    setTimeout(() => { try { sb.removeChannel(ch); } catch (e) {} }, 800);
  });
}

function onRingMeta(p) {
  if (!p || typeof p.callId !== 'string' || typeof p.sdpN !== 'number' || !p.sdpN) return;
  if (p.from === myId) return;

  if (state !== 'idle') { sendBusy(p.callId); return; } /* مشغولیم — خبر بده */

  incBuf = {
    callId: p.callId,
    kind: (p.kind === 'video') ? 'video' : 'audio',
    from: p.from,
    name: p.name || 'کاربر',
    n: p.sdpN,
    parts: new Array(p.sdpN),
    t: setTimeout(() => { incBuf = null; }, 15000), /* اگر ناقص ماند بی‌خیال */
  };
}

function onRingChunk(p) {
  if (!incBuf || !p || p.callId !== incBuf.callId) return;
  if (typeof p.i !== 'number' || typeof p.part !== 'string') return;

  incBuf.parts[p.i] = p.part;
  if (!incBuf.parts.every(Boolean)) return;

  const meta = incBuf;
  const sdp = meta.parts.join('');
  incBuf = null;
  clearTimeout(meta.t);

  deliverRing({
    callId: meta.callId,
    kind: meta.kind,
    from: meta.from,
    name: meta.name,
    sdp: sdp,
  });
}

function deliverRing(p) {
  if (!validRing(p) || p.from === myId) return;

  callId = p.callId;
  kind = (p.kind === 'video') ? 'video' : 'audio';
  peerId = p.from;
  isCaller = false;
  answered = false;
  iceReady = false;
  pendingIce = [];
  incomingOffer = p.sdp;
  state = 'incoming';

  showOverlay(kind === 'video');
  setStatus(kind === 'video' ? 'تماس تصویری ورودی…' : 'تماس صوتی ورودی…');
  showActions('incoming');
  paintPeer();
  getUserInfo(peerId).then((info) => { peerInfo = info; paintPeer(); });
  startRing(true);

  timeoutT = setTimeout(() => {
    if (state === 'incoming') endCall('idle', '');
  }, INCOMING_MAX_MS);
}

function onCancel(p) {
  if (incBuf && p && p.callId === incBuf.callId) { clearTimeout(incBuf.t); incBuf = null; }
  if (state === 'incoming' && p && p.callId === callId) endCall('idle', '');
}

/* ---------------- قبول / رد / قطع ---------------- */

async function acceptCall() {
  if (state !== 'incoming') return;
  stopRing();
  clearTimeout(timeoutT); timeoutT = null;

  state = 'active';
  setStatus('در حال اتصال…');
  showActions('active');

  try {
    localStream = await getMedia(kind);
  } catch (e) {
    alert(permMsg(e));
    sendOn(sessCh, 'bye', {});
    endCall('failed', '');
    return;
  }

  attachLocalVideo();

  pc = buildPC();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: incomingOffer });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
  } catch (e) {
    console.error('rz-call answer error:', e);
    sendOn(sessCh, 'bye', {});
    endCall('failed', 'خطا در اتصال');
    return;
  }

  sessCh = await openChannel(SESS_CH(callId), {
    ice: onIce,
    bye: () => endCall('done', 'تماس تمام شد'),
  });

  await sendSdp(sessCh, 'answer', { callId: callId }, pc.localDescription.sdp);
  flushIce();
}

async function declineCall() {
  if (state !== 'incoming') return;
  stopRing();
  clearTimeout(timeoutT); timeoutT = null;

  const ch = await openChannel(SESS_CH(callId), {});
  await sendOn(ch, 'decline', {});
  setTimeout(() => { try { sb.removeChannel(ch); } catch (e) {} }, 800);

  endCall('idle', '');
}

async function hangup() {
  if (state === 'outgoing') {
    await sendOn(peerUserCh, 'cancel', { callId: callId });
    endCall('idle', '');
  } else {
    await sendOn(sessCh, 'bye', {});
    endCall('done', 'تماس تمام شد');
  }
}

/* ---------------- اتصال WebRTC ---------------- */

function buildPC() {
  const p = new RTCPeerConnection(ICE_CONFIG);

  p.onicecandidate = (e) => {
    if (!e.candidate) return;
    const c = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
    if (iceReady && sessCh) sendOn(sessCh, 'ice', { cand: c });
    else pendingIce.push(c);
  };

  p.ontrack = (e) => {
    remoteStream = remoteStream || new MediaStream();
    const tracks = (e.streams && e.streams[0]) ? e.streams[0].getTracks() : [e.track];
    tracks.forEach((t) => {
      if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
    });
    if (UI.remoteV) {
      UI.remoteV.srcObject = remoteStream;
      if (UI.remoteV.play) UI.remoteV.play().catch(() => {});
    }
  };

  p.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState;
    if (s === 'connected') onConnected();
    else if (s === 'failed') endCall('failed', 'اتصال برقرار نشد 😕');
    else if (s === 'disconnected') {
      setTimeout(() => {
        if (pc && pc.connectionState === 'disconnected') endCall('failed', 'ارتباط قطع شد');
      }, 3500);
    }
  };

  return p;
}

async function onIce(p) {
  if (!pc || !p || !p.cand) return;
  try { await pc.addIceCandidate(p.cand); } catch (e) { /* کاندید بد را رد کن */ }
}

function onAnswerMeta(p) {
  if (state !== 'outgoing' || !p || p.callId !== callId) return;
  if (typeof p.sdpN !== 'number' || !p.sdpN) return;
  ansBuf = { n: p.sdpN, parts: new Array(p.sdpN) };
}

function onAnswerChunk(p) {
  if (!ansBuf || !p || p.callId !== callId) return;
  if (typeof p.i !== 'number' || typeof p.part !== 'string') return;

  ansBuf.parts[p.i] = p.part;
  if (!ansBuf.parts.every(Boolean)) return;

  const sdp = ansBuf.parts.join('');
  ansBuf = null;
  applyAnswer(sdp);
}

async function applyAnswer(sdp) {
  if (state !== 'outgoing' || !pc || typeof sdp !== 'string') return;
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: sdp });
    clearTimeout(timeoutT); timeoutT = null;
    stopRing();
    setStatus('در حال اتصال…');
    flushIce();
  } catch (e) {
    console.error('rz-call setRemote error:', e);
    endCall('failed', 'خطا در اتصال');
  }
}

function flushIce() {
  iceReady = true;
  const list = pendingIce.slice();
  pendingIce = [];
  list.forEach((c) => sendOn(sessCh, 'ice', { cand: c }));
}

function onConnected() {
  if (timerInt) return;
  answered = true;
  startedAt = Date.now();
  stopRing();
  setStatus('');
  UI.sub.textContent = '';
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    UI.timer.textContent = fmtDur(s);
  }, 1000);
}

/* ---------------- پایان تماس ---------------- */

function endCall(reason, msg) {
  if (state === 'idle' || state === 'ending') return;

  const wasCaller = isCaller;
  const hadTimer = timerInt != null;
  state = 'ending';

  stopRing();
  clearTimeout(timeoutT); timeoutT = null;
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
  iceReady = false;

  try {
    if (pc) {
      pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null;
      pc.close();
    }
  } catch (e) {}
  pc = null;

  try { if (localStream) localStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  localStream = null;
  remoteStream = null;
  if (UI.remoteV) UI.remoteV.srcObject = null;
  if (UI.localV) UI.localV.srcObject = null;

  const drop = [];
  if (sessCh) drop.push(sessCh);
  if (peerUserCh) drop.push(peerUserCh);
  sessCh = null; peerUserCh = null;
  drop.forEach((c) => { try { sb.removeChannel(c).catch(() => {}); } catch (e) {} });

  if (msg) setStatus(msg);

  /* 📝 ثبت لاگ تماس در چت (فقط سمت تماس‌گیرنده) */
  if (reason === 'done' && wasCaller && hadTimer && chatIdForLog) {
    const dur = startedAt ? fmtDur(Math.floor((Date.now() - startedAt) / 1000)) : '0:00';
    logCall('📞 ' + (kind === 'video' ? 'تماس تصویری' : 'تماس صوتی') + ' • ' + dur);
  }

  const wait = msg ? 1400 : 350;
  setTimeout(() => {
    if (UI.ov) UI.ov.style.display = 'none';
    incomingOffer = null;
    callId = null;
    peerId = null;
    peerInfo = null;
    startedAt = 0;
    state = 'idle';
  }, wait);

  if (incBuf) { clearTimeout(incBuf.t); incBuf = null; }
  ansBuf = null;
}

async function logCall(text) {
  if (!chatIdForLog) return;
  try {
    const me = getMe() || {};
    await sb.from('messages').insert({
      chat_id: chatIdForLog,
      text: text,
      sender_name: me.name || 'کاربر',
      uid: myId,
      time: Date.now(),
    });
    await sb.from('chats').update({
      last_message: text,
      last_message_time: Date.now(),
      last_message_sender: myId,
    }).eq('id', chatIdForLog);
  } catch (e) { /* لاگ مهم نیست، خراب نشو */ }
}

/* ---------------- راه‌اندازی ---------------- */

async function setupChatPage() {
  const cid = new URLSearchParams(location.search).get('id');
  if (!cid) return; /* مثلا chats.html — فقط گوش به زنگ می‌مانیم */
  chatIdForLog = cid;

  let chat = null;
  try {
    const r = await sb.from('chats').select('type,members').eq('id', cid).maybeSingle();
    chat = r.data;
  } catch (e) { return; }

  if (!chat || chat.type !== 'private') return; /* فعلاً فقط چت خصوصی */
  chatPeer = (chat.members || []).find((u) => u !== myId);
  if (!chatPeer) return;

  injectCallButtons();
}

function injectCallButtons() {
  const actions = document.querySelector('.header-actions');
  if (!actions || document.getElementById('rz-call-audio')) return;

  const mk = (id, txt, k, title) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'hdr-btn rz-call-btn';
    b.title = title;
    b.textContent = txt;
    b.onclick = () => startCall(k);
    return b;
  };

  actions.insertBefore(mk('rz-call-video', '📹', 'video', 'تماس تصویری'), actions.firstChild);
  actions.insertBefore(mk('rz-call-audio', '📞', 'audio', 'تماس صوتی'), actions.firstChild);
}

async function boot() {
  for (let i = 0; i < 150; i++) { /* حداکثر ~۱۵ ثانیه صبر برای لاگین */
    myId = getMyId();
    if (myId) break;
    await sleep(100);
  }
  if (!myId) return;

  inboxCh = await openChannel(USER_CH(myId), {
    ring: onRingMeta,
    'ring-chunk': onRingChunk,
    cancel: onCancel,
  });
  ready = true;

  await setupChatPage();
}

window.addEventListener('beforeunload', () => {
  try {
    if (state === 'outgoing' && peerUserCh)
      peerUserCh.send({ type: 'broadcast', event: 'cancel', payload: { callId: callId } });
    else if ((state === 'active' || state === 'incoming') && sessCh)
      sessCh.send({ type: 'broadcast', event: 'bye', payload: {} });
  } catch (e) {}
  try { if (localStream) localStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
});

boot();

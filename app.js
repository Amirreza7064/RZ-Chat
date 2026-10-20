import { sb, initAuth, escapeHTML, renderAvatar, avatarHTML, getUserInfo, getMyId, getMe } from './auth.js';

let myId = null;
let myName = "کاربر";
let chatId = new URLSearchParams(location.search).get("id");
let chatData = null;
let otherInfo = null;
let isPrivate = false;
let isSaved = false;
let isAdmin = false;
let messagesCache = {};
const userCache = {};

let replyState = null;
let fwMid = null;
let typingTimeout = null;
let typingLast = 0;

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

const errBanner = document.createElement("div");
errBanner.style.cssText =
  "display:none;background:#c0392b;color:#fff;padding:8px 15px;font-size:12px;" +
  "font-family:tahoma;position:fixed;top:0;right:0;left:0;z-index:999;text-align:center";
document.body.appendChild(errBanner);
function showErr(m) {
  console.error(m);
  errBanner.style.display = "block";
  errBanner.textContent = "⚠️ " + m;
}
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  showErr((r && r.message) || String(r));
});

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

function previewOf(d) {
  if (d.deleted) return "🚫 حذف شده";
  if (d.image) return "🖼 عکس";
  if (d.audio) return "🎤 پیام صوتی";
  return (d.text || "").slice(0, 80);
}

function showComposer() {
  document.getElementById("composer").style.display = "block";
  document.getElementById("send-box").style.display = "flex";
}

/* ================= 🟢 حضور آنلاین ================= */

function lastSeenText(ts) {
  const d = Date.now() - ts;
  if (d < 65000) return "🟢 آنلاین";
  const m = Math.floor(d / 60000);
  if (m < 60) return "آخرین بازدید " + m + " دقیقه پیش";
  const h = Math.floor(m / 60);
  if (h < 24) return "آخرین بازدید " + h + " ساعت پیش";
  const dd = Math.floor(h / 24);
  if (dd < 30) return "آخرین بازدید " + dd + " روز پیش";
  return "آخرین بازدید خیلی وقت پیش";
}

async function heartbeat() {
  if (!myId) return;
  sb.from("profiles").update({ last_seen: Date.now() })
    .eq("id", myId).then(() => {}, () => {});
}

async function refreshPeer() {
  if (!isPrivate || !otherInfo || !otherInfo.id) return;
  const info = await getUserInfo(otherInfo.id);
  if (info) { otherInfo = info; updateSub(); }
}

function updateSub() {
  const el = document.getElementById("chat-sub");
  if (!el || !chatData) return;

  if (isSaved) { el.textContent = "فقط برای خودت"; return; }

  const typing = chatData.typing || {};
  const now = Date.now();
  const writing = Object.entries(typing).find(([uid, ts]) =>
    uid !== myId && (now - ts) < 5000
  );
  if (writing) { el.textContent = "✍️ در حال نوشتن..."; return; }

  if (isPrivate) {
    if (otherInfo && otherInfo.last_seen) {
      el.textContent = lastSeenText(otherInfo.last_seen);
      return;
    }
    el.textContent = (otherInfo && otherInfo.username)
      ? "@" + otherInfo.username : "چت خصوصی";
    return;
  }

  el.textContent = (chatData.type === "channel" ? "کانال" : "گروه")
    + " • " + (chatData.members || []).length + " عضو";
}

function markAsRead() {
  if (!myId || !chatId) return;
  sb.from("chat_meta").upsert({
    user_id: myId, chat_id: chatId,
    last_read_time: Date.now(), mark_unread: false
  }, { onConflict: "user_id,chat_id" }).then(() => {}, () => {});
}

/* ================= ✓✓ تیک خوانده‌شدن (گام ۴) ================= */
/* تیک از مسیر chat_meta می‌آید — بدون آپدیت روی جدول messages */

let otherReadTime = 0;

async function refreshTicks() {
  if (!myId || !chatId || isSaved) return;
  try {
    const { data, error } = await sb.rpc("chat_last_read", { p_chat: chatId });
    if (error || data === null || data === undefined) return;
    const t = Number(data);
    if (!isFinite(t) || t === otherReadTime) return;
    otherReadTime = t;
    document.querySelectorAll("#messages .message.mine").forEach((el) => {
      const d = messagesCache[el.getAttribute("data-mid")];
      const tk = el.querySelector(".ticks");
      if (!d || !tk) return;
      tk.textContent = (d.time || 0) <= otherReadTime ? "✓✓" : "✓";
    });
  } catch (e) { /* بی‌خیال */ }
}

setInterval(refreshTicks, 4000);

/* ================= شروع ================= */

async function start() {
  if (!await initAuth()) return;
  myId = getMyId();

  /* 🟢 هر ۳۰ ثانیه خودم را آنلاین نشان بده */
  heartbeat();
  setInterval(heartbeat, 30000);
  const meData = getMe();
  myName = meData.name || "کاربر";

  if (!chatId) { location.href = "chats.html"; return; }

  try {
    const { data: chat, error } = await sb.from("chats")
      .select("*").eq("id", chatId).maybeSingle();
    if (error) throw error;

    if (!chat) {
      alert("این چت وجود ندارد");
      location.href = "chats.html";
      return;
    }
    chatData = chat;

    if (chatData.type === "saved") {
      isSaved = true;
      document.getElementById("chat-icon").textContent = "🔖";
      document.getElementById("chat-title").textContent = "پیام‌های ذخیره‌شده";
      updateSub();
      showComposer();

    } else if (chatData.type === "private") {
      isPrivate = true;
      const members = chatData.members || [];
      if (!members.includes(myId)) {
        alert("این چت مال تو نیست ❌");
        location.href = "chats.html";
        return;
      }
      const otherUid = members.find(u => u !== myId);
      otherInfo = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
      renderAvatar(document.getElementById("chat-icon"), otherInfo);
      document.getElementById("chat-title").textContent = otherInfo.name || "کاربر";
      updateSub();
      showComposer();

    } else {
      const members = chatData.members || [];
      isAdmin = (chatData.admins || []).includes(myId);
      const isMember = members.includes(myId);

      document.getElementById("chat-title").textContent = chatData.name;
      setChatIcon();
      updateSub();

      if (!isMember) {
        document.getElementById("join-text").textContent =
          chatData.type === "channel"
            ? "برای دنبال کردن این کانال عضو شو:"
            : "برای ارسال پیام در این گروه عضو شو:";
        document.getElementById("join-bar").style.display = "flex";
      } else {
        if (chatData.type !== "channel" || isAdmin) showComposer();
        document.getElementById("invite-btn").style.display = "inline-block";
      }
      document.getElementById("chat-header").style.cursor = "pointer";
      document.getElementById("chat-header").onclick = openInfo;
    }

    sb.channel("chat-" + chatId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chats", filter: "id=eq." + chatId },
        (p) => {
          if (p.new) { chatData = p.new; updateSub(); }
        })
      .subscribe();

    sb.channel("msgs-" + chatId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: "chat_id=eq." + chatId },
        () => loadMessages())
      .subscribe();

    if (isPrivate) setInterval(refreshPeer, 30000);

    const input = document.getElementById("messageInput");
    input.addEventListener("input", setTyping);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    await loadMessages();

    /* 🔍 پشتیبانی از جستجوی سراسری: chat.html?id=...&q=...&mid=... (جدید) */
    const qp = new URLSearchParams(location.search).get("q");
    const midp = new URLSearchParams(location.search).get("mid");
    if (qp) {
      window.toggleSearch();
      const si = document.getElementById("search-input");
      si.value = qp;
      window.onCSearch(si, false);
      if (midp && searchHits.includes(midp)) {
        gotoSearch(searchHits.indexOf(midp));
      }
    }
  } catch (e) {
    showErr("خطای بارگذاری: " + e.message);
  }
}

function setChatIcon() {
  const el = document.getElementById("chat-icon");
  if (!el) return;
  if (chatData && chatData.photo) {
    el.innerHTML = `<img src="${chatData.photo}" alt="">`;
  } else {
    el.textContent = (chatData && chatData.type === "channel") ? "📢" : "👥";
  }
}

/* ================= ✍️ در حال نوشتن ================= */

function setTyping() {
  if (!myId || isSaved) return;
  if (chatData && chatData.type === "channel" && !isAdmin) return;

  const now = Date.now();
  if (now - typingLast < 2000) return;
  typingLast = now;

  const obj = { ...(chatData.typing || {}) };
  obj[myId] = now;
  sb.rpc("set_typing", { p_chat: chatId, p_val: obj }).then(() => {}, () => {});

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, 6000);
}

async function clearTyping() {
  if (!myId || !chatId || isSaved) return;
  try {
    const obj = { ...(chatData.typing || {}) };
    delete obj[myId];
    await sb.rpc("set_typing", { p_chat: chatId, p_val: obj });
  } catch (e) { /* ignore */ }
}

/* ================= پروفایل چت ================= */

window.openInfo = async function () {
  if (!chatData || isPrivate || isSaved) return;
  document.getElementById("info-modal").classList.add("show");
  document.getElementById("info-modal-title").textContent =
    chatData.type === "channel" ? "اطلاعات کانال" : "اطلاعات گروه";

  setInfoAvatar();
  if (isAdmin) {
    document.getElementById("info-avatar").onclick = () =>
      document.getElementById("chat-photo-input").click();
  }

  document.getElementById("info-name").value = chatData.name || "";
  document.getElementById("info-desc").value = chatData.description || "";
  document.getElementById("info-invite").value =
    location.origin + location.pathname + "?id=" + chatId;

  document.getElementById("info-name").disabled = !isAdmin;
  document.getElementById("info-desc").disabled = !isAdmin;
  document.getElementById("info-admin-tools").style.display = isAdmin ? "block" : "none";
  document.getElementById("add-member-sec").style.display = isAdmin ? "block" : "none";

  await renderMembers();
};

function setInfoAvatar() {
  const el = document.getElementById("info-avatar");
  if (chatData && chatData.photo) {
    el.innerHTML = `<img src="${chatData.photo}" alt="">`;
  } else {
    el.textContent = (chatData && chatData.type === "channel") ? "📢" : "👥";
  }
}

window.closeInfo = function () {
  document.getElementById("info-modal").classList.remove("show");
};

async function renderMembers() {
  const list = document.getElementById("members-list");
  const members = chatData.members || [];
  const admins = chatData.admins || [];
  list.innerHTML = "<p class='hint'>⏳ ...</p>";

  let html = "";
  for (const uid of members) {
    const info = await getUserInfo(uid);
    html += `
      <div class="member-line">
        <div class="avatar">${avatarHTML(info)}</div>
        <div class="member-mid">
          <div class="chat-name">${escapeHTML(info.name || "کاربر")}${uid === myId ? " (تو)" : ""}</div>
          <div class="chat-last">${info.username ? "@" + escapeHTML(info.username) : ""}</div>
        </div>
        ${admins.includes(uid) ? '<span class="crown">👑</span>' : ""}
        ${isAdmin && uid !== myId && uid !== chatData.created_by
          ? `<button class="mini-danger" onclick="removeMember('${uid}')">✖</button>` : ""}
      </div>`;
  }
  list.innerHTML = html;
}

window.addMember = async function () {
  const q = document.getElementById("add-member-q").value.trim().toLowerCase();
  if (!q) return;
  let uid = null;

  if (q.startsWith("@")) {
    const r = await sb.from("profiles").select("id").eq("username", q.slice(1)).maybeSingle();
    uid = r.data && r.data.id;
  } else if (/^(\+98|98|0)?9\d{9}$/.test(q.replace(/\s/g, ""))) {
    let p = q.replace(/\D/g, "");
    if (p.startsWith("98")) p = "0" + p.slice(2);
    if (p.length === 10) p = "0" + p;
    const r = await sb.from("profiles").select("id").eq("phone", p).maybeSingle();
    uid = r.data && r.data.id;
  } else if (q.includes("@")) {
    const r = await sb.from("profiles").select("id").eq("email", q).limit(1);
    uid = r.data && r.data[0] && r.data[0].id;
  }

  if (!uid) { alert("پیدا نشد ❌"); return; }
  if ((chatData.members || []).includes(uid)) { alert("از قبل عضوه"); return; }

  const { error } = await sb.rpc("add_member", { p_chat: chatId, p_user: uid });
  if (error) { alert("نشد: " + error.message); return; }

  chatData.members = [...(chatData.members || []), uid];
  document.getElementById("add-member-q").value = "";
  await renderMembers();
  updateSub();
};

window.removeMember = async function (uid) {
  if (!confirm("این عضو حذف شود؟")) return;
  const { error } = await sb.rpc("remove_member", { p_chat: chatId, p_user: uid });
  if (error) { alert("نشد: " + error.message); return; }
  chatData.members = (chatData.members || []).filter(u => u !== uid);
  await renderMembers();
  updateSub();
};

window.saveChatInfo = async function () {
  const name = document.getElementById("info-name").value.trim();
  const description = document.getElementById("info-desc").value.trim();
  if (!name) { alert("نام نمی‌تواند خالی باشد"); return; }
  const { error } = await sb.from("chats")
    .update({ name, description }).eq("id", chatId);
  if (error) { alert("ذخیره نشد: " + error.message); return; }
  chatData.name = name;
  chatData.description = description;
  document.getElementById("chat-title").textContent = name;
  alert("ذخیره شد ✅");
};

window.uploadChatPhoto = function (input) {
  const file = input.files[0];
  if (!file || !isAdmin) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const size = 200;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        const { error } = await sb.from("chats").update({ photo: dataUrl }).eq("id", chatId);
        if (error) throw error;
        chatData.photo = dataUrl;
        setChatIcon();
        setInfoAvatar();
        alert("عکس ذخیره شد ✅");
      } catch (err) {
        showErr("خطای ذخیره عکس: " + err.message);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.copyInfoInvite = function () {
  const input = document.getElementById("info-invite");
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => alert("کپی شد ✅"))
    .catch(() => document.execCommand("copy"));
};

/* ================= عضویت با لینک ================= */

window.joinChat = async function () {
  if (!myId || !chatData) return;
  const { error } = await sb.rpc("join_chat", { p_chat: chatId });
  if (error) { alert("عضویت ناموفق بود"); return; }
  location.reload();
};

/* ================= ↩️ پاسخ ================= */

window.replyTo = function (mid) {
  const d = messagesCache[mid];
  if (!d) return;
  replyState = {
    mid: mid,
    name: d.sender_name || "کاربر",
    preview: previewOf(d)
  };
  showReplyBar();
};

function showReplyBar() {
  if (!replyState) return;
  document.getElementById("reply-name").textContent = "پاسخ به " + replyState.name;
  document.getElementById("reply-text").textContent = replyState.preview;
  document.getElementById("reply-bar").style.display = "flex";
  document.getElementById("messageInput").focus();
}

window.cancelReply = function () {
  replyState = null;
  document.getElementById("reply-bar").style.display = "none";
};

window.jumpTo = function (mid) {
  const el = document.querySelector(`#messages [data-mid="${mid}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-flash");
  setTimeout(() => el.classList.remove("msg-flash"), 1300);
};

/* ================= 😊 ری‌اکشن ================= */

window.toggleReaction = async function (mid, emoji) {
  const d = messagesCache[mid];
  if (!d || d.deleted) return;
  const cur = { ...(d.reactions || {}) };
  if (cur[myId] === emoji) delete cur[myId];
  else cur[myId] = emoji;

  const { error } = await sb.from("messages")
    .update({ reactions: cur }).eq("id", mid);
  if (error) showErr("واکنش ثبت نشد: " + error.message);
};

window.reactFromMenu = function (mid, emoji) {
  toggleReaction(mid, emoji);
};

/* ================= ↪️ فوروارد ================= */

window.openForward = async function (mid) {
  fwMid = mid;
  document.getElementById("fw-modal").classList.add("show");
  await renderFwList();
};

window.closeForward = function () {
  document.getElementById("fw-modal").classList.remove("show");
  fwMid = null;
};

async function renderFwList() {
  const list = document.getElementById("fw-list");
  list.innerHTML = "<p class='hint'>⏳ ...</p>";

  const { data, error } = await sb.from("chats")
    .select("*").contains("members", [myId]);
  if (error) { list.innerHTML = "<p class='hint'>خطا</p>"; return; }

  let html = "";
  for (const c of (data || [])) {
    let icon, title;

    if (c.type === "saved") {
      icon = "🔖";
      title = "پیام‌های ذخیره‌شده";
    } else if (c.type === "private") {
      const otherUid = (c.members || []).find(u => u !== myId);
      const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
      icon = avatarHTML(info);
      title = info.name || "کاربر";
    } else {
      if (c.type === "channel" && !(c.admins || []).includes(myId)) continue;
      icon = c.type === "channel" ? "📢" : "👥";
      title = c.name || "چت";
    }

    html += `
      <div class="fw-item" onclick="doForward('${c.id}')">
        <div class="avatar">${icon}</div>
        <div>${escapeHTML(title)}</div>
      </div>`;
  }

  if (!html) html = "<p class='hint'>چتی برای فوروارد نیست</p>";
  list.innerHTML = html;
}

window.doForward = async function (targetId) {
  const d = messagesCache[fwMid];
  if (!d || d.deleted) return;

  const nd = {
    chat_id: targetId,
    sender_name: d.sender_name || myName,
    uid: myId,
    time: Date.now(),
    forwarded: true
  };
  if (d.text) nd.text = d.text;
  if (d.image) nd.image = d.image;
  if (d.audio) { nd.audio = d.audio; nd.audio_duration = d.audio_duration || 0; }

  const { error } = await sb.from("messages").insert(nd);
  if (error) { showErr("فوروارد نشد: " + error.message); return; }

  await sb.from("chats").update({
    last_message: "↪️ " + previewOf(d),
    last_message_time: Date.now(),
    last_message_sender: myId
  }).eq("id", targetId);

  closeForward();
  alert("فوروارد شد ✅");
};

/* ================= ارسال پیام متنی ================= */

async function sendMessage() {
  if (!chatData || !myId) return;
  if (!isPrivate && !isSaved && chatData.type === "channel" && !isAdmin) return;

  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  const msg = {
    chat_id: chatId,
    text: text,
    sender_name: myName,
    uid: myId,
    time: Date.now()
  };
  if (replyState) {
    msg.reply_to = {
      mid: replyState.mid, name: replyState.name, text: replyState.preview
    };
  }

  const { error } = await sb.from("messages").insert(msg);
  if (error) { showErr("ارسال نشد: " + error.message); return; }

  await sb.from("chats").update({
    last_message: text,
    last_message_time: Date.now(),
    last_message_sender: myId
  }).eq("id", chatId);

  input.value = "";
  input.focus();
  cancelReply();
  clearTyping();
}

window.sendMessage = sendMessage;

/* ================= ارسال عکس ================= */

window.sendImage = function (input) {
  const file = input.files[0];
  if (!file || !myId) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const max = 700;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          const r = Math.min(max / w, max / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.65);

        if (dataUrl.length > 900 * 1024) {
          alert("عکس خیلی بزرگ است");
          return;
        }

        const msg = {
          chat_id: chatId, text: "", image: dataUrl,
          sender_name: myName, uid: myId, time: Date.now()
        };
        if (replyState) {
          msg.reply_to = {
            mid: replyState.mid, name: replyState.name, text: replyState.preview
          };
        }

        const { error } = await sb.from("messages").insert(msg);
        if (error) throw error;

        await sb.from("chats").update({
          last_message: "🖼 عکس",
          last_message_time: Date.now(),
          last_message_sender: myId
        }).eq("id", chatId);

        cancelReply();
      } catch (err) {
        showErr("خطای ارسال عکس: " + err.message);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = "";
};

/* ================= پیام صوتی ================= */

let mediaRecorder = null;
let audioChunks = [];
let recTimer = null;
let recSeconds = 0;
let recCancelled = false;

window.startRecording = async function () {
  if (!chatData || !myId) return;
  if (chatData.type === "channel" && !isAdmin) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert("مرورگرت از ضبط صدا پشتیبانی نمی‌کند");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "";
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    audioChunks = [];
    recCancelled = false;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recTimer);
      document.getElementById("rec-box").style.display = "none";
      document.getElementById("send-box").style.display = "flex";

      if (recCancelled) return;

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      if (blob.size > 700 * 1024) {
        alert("پیام صوتی خیلی طولانی است (حداکثر حدود یک دقیقه)");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const msg = {
          chat_id: chatId, text: "", audio: ev.target.result,
          audio_duration: recSeconds,
          sender_name: myName, uid: myId, time: Date.now()
        };
        if (replyState) {
          msg.reply_to = {
            mid: replyState.mid, name: replyState.name, text: replyState.preview
          };
        }
        const { error } = await sb.from("messages").insert(msg);
        if (error) { showErr("ارسال نشد: " + error.message); return; }

        await sb.from("chats").update({
          last_message: "🎤 پیام صوتی",
          last_message_time: Date.now(),
          last_message_sender: myId
        }).eq("id", chatId);

        cancelReply();
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start();
    recSeconds = 0;
    document.getElementById("send-box").style.display = "none";
    document.getElementById("rec-box").style.display = "flex";
    document.getElementById("rec-time").textContent = "0:00";

    recTimer = setInterval(() => {
      recSeconds++;
      document.getElementById("rec-time").textContent = fmtDur(recSeconds);
      if (recSeconds >= 60) stopRecording(true);
    }, 1000);

  } catch (e) {
    console.error(e);
    alert("دسترسی به میکروفون ممکن نشد");
  }
};

window.stopRecording = function (send) {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  recCancelled = !send;
  mediaRecorder.stop();
};

/* ================= 🎵 پخش‌کننده موجی ================= */

function hashSeed(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function barsHTML(seed) {
  let x = seed % 233280;
  let h = "";
  for (let i = 0; i < 28; i++) {
    x = (x * 9301 + 49297) % 233280;
    h += `<span style="height:${7 + (x % 18)}px"></span>`;
  }
  return h;
}

function paintWave(mid, p) {
  const w = document.getElementById("wave-" + mid);
  if (!w) return;
  const spans = w.children;
  const n = Math.floor(p * spans.length);
  for (let i = 0; i < spans.length; i++) {
    spans[i].classList.toggle("on", i < n);
  }
}

window.vplay = function (btn, mid) {
  const aud = document.getElementById("aud-" + mid);
  if (!aud) return;

  document.querySelectorAll("#messages audio").forEach(a => { if (a !== aud) a.pause(); });
  document.querySelectorAll("#messages .vplay").forEach(b => { if (b !== btn) b.textContent = "▶"; });

  if (aud.paused) {
    aud.play();
    btn.textContent = "⏸";
    aud.ontimeupdate = () => {
      const dur = (isFinite(aud.duration) && aud.duration > 0)
        ? aud.duration
        : ((messagesCache[mid] || {}).audio_duration || 1);
      paintWave(mid, Math.min(aud.currentTime / dur, 1));
    };
    aud.onended = () => {
      btn.textContent = "▶";
      paintWave(mid, 0);
    };
  } else {
    aud.pause();
    btn.textContent = "▶";
  }
};

/* ================= نمایش پیام‌ها ================= */

async function loadMessages() {
  const { data, error } = await sb.from("messages")
    .select("*").eq("chat_id", chatId).order("time");

  if (error) { showErr("خطای پیام‌ها: " + error.message); return; }

  const box = document.getElementById("messages");
  box.innerHTML = "";
  messagesCache = {};

  (data || []).forEach((d) => {
    messagesCache[d.id] = d;
    box.innerHTML += messageHTML(d, d.id);
  });

  box.scrollTop = box.scrollHeight;
  markAsRead();
  refreshTicks();

  /* 🔍 اگر جستجویی باز است، هایلایت‌ها را دوباره اعمال کن (جدید) */
  if (searchQ) {
    const si = document.getElementById("search-input");
    if (si) window.onCSearch(si, false);
  }
}

function messageHTML(d, mid) {
  const mine = d.uid === myId;
  const time = new Date(d.time).toLocaleTimeString("fa-IR", {
    hour: "2-digit", minute: "2-digit"
  });

  let inner = "";
  if (d.deleted) {
    inner = `<div class="text deleted-msg">🚫 این پیام حذف شده است</div>`;
  } else {
    if (d.reply_to) {
      inner += `
        <div class="reply-box" onclick="jumpTo('${d.reply_to.mid}')">
          <div class="reply-name">${escapeHTML(d.reply_to.name)}</div>
          <div class="reply-text">${escapeHTML(d.reply_to.text || "")}</div>
        </div>`;
    }
    if (d.image) inner += `<img class="msg-img" src="${d.image}" alt="عکس">`;
    if (d.audio) inner += `
      <div class="voice-row">
        <button class="vplay" onclick="vplay(this,'${mid}')">▶</button>
        <div class="wave" id="wave-${mid}">${barsHTML(hashSeed(mid))}</div>
        <span class="voice-dur">${fmtDur(d.audio_duration || 0)}</span>
        <audio id="aud-${mid}" src="${d.audio}" preload="none" style="display:none"></audio>
      </div>`;
    if (d.text) inner += `<div class="text">${escapeHTML(d.text)}</div>`;
  }

  const senderHtml = (!mine && !isPrivate && !isSaved)
    ? `<div class="sender">${escapeHTML(d.sender_name || "ناشناس")}</div>` : "";

  const fwdTag = d.forwarded ? '<span class="fwd-tag">↪️ فوروارد</span>' : "";
  const editedTag = (d.edited && !d.deleted)
    ? '<span class="edited"> (ویرایش‌شده)</span>' : "";

  /* ✓✓ تیک بر اساس آخرین خواندن طرف مقابل (گام ۴) */
  const tick = (mine && !isSaved)
    ? (otherReadTime > 0 && (d.time || 0) <= otherReadTime
        ? ' <span class="ticks">✓✓</span>'
        : ' <span class="ticks">✓</span>')
    : "";

  let rHtml = "";
  if (!d.deleted && d.reactions) {
    const groups = {};
    Object.entries(d.reactions).forEach(([uid, e]) => {
      (groups[e] = groups[e] || []).push(uid);
    });
    for (const [e, uids] of Object.entries(groups)) {
      const mineR = uids.includes(myId);
      rHtml += `<span class="rchip ${mineR ? "mine" : ""}" onclick="toggleReaction('${mid}','${e}')">${e}${uids.length > 1 ? " " + uids.length : ""}</span>`;
    }
  }

  return `
    <div class="message ${mine ? "mine" : ""}" data-mid="${mid}">
      ${senderHtml}
      ${fwdTag}
      ${inner}
      <div class="time">${time}${editedTag}${tick}</div>
      ${rHtml ? `<div class="rbar">${rHtml}</div>` : ""}
    </div>`;
}

document.getElementById("messages").addEventListener("click", (e) => {
  if (e.target.classList.contains("msg-img")) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write('<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><img src="' + e.target.src + '" style="max-width:100%;max-height:100%"></body>');
    }
  }
});

/* ================= منوی راست‌کلیک پیام ================= */

const msgMenu = document.getElementById("msg-menu");

document.addEventListener("contextmenu", (e) => {
  const m = e.target.closest("#messages .message[data-mid]");
  if (!m) { msgMenu.style.display = "none"; return; }
  e.preventDefault();

  const mid = m.getAttribute("data-mid");
  const d = messagesCache[mid];
  if (!d || d.deleted) return;

  const mine = d.uid === myId;
  let html = "";

  html += `<div class="react-row">${["👍", "❤️", "😂", "😮", "😢"]
    .map(em => `<button onclick="reactFromMenu('${mid}','${em}')">${em}</button>`).join("")}</div>`;

  html += `<button onclick="replyTo('${mid}')">↩️ پاسخ</button>`;
  html += `<button onclick="openForward('${mid}')">↪️ فوروارد</button>`;

  if (mine && d.text && !d.image && !d.audio && !d.forwarded) {
    html += `<button onclick="editMsg('${mid}')">✏️ ویرایش</button>`;
  }
  if (mine || (chatData && isAdmin && !isPrivate && !isSaved)) {
    html += `<button class="danger" onclick="deleteMsg('${mid}')">🗑 حذف</button>`;
  }

  msgMenu.innerHTML = html;
  msgMenu.style.display = "block";
  const w = msgMenu.offsetWidth, h = msgMenu.offsetHeight;
  msgMenu.style.left = Math.min(e.clientX, innerWidth - w - 8) + "px";
  msgMenu.style.top = Math.min(e.clientY, innerHeight - h - 8) + "px";
});

document.addEventListener("click", () => { msgMenu.style.display = "none"; });

window.editMsg = async function (mid) {
  const cur = (messagesCache[mid] || {}).text || "";
  const t = prompt("متن جدید:", cur);
  if (t === null) return;
  const nt = t.trim();
  if (!nt) { alert("متن خالی است"); return; }
  const { error } = await sb.from("messages")
    .update({ text: nt, edited: true }).eq("id", mid);
  if (error) showErr("ویرایش نشد: " + error.message);
};

window.deleteMsg = async function (mid) {
  if (!confirm("این پیام حذف شود؟")) return;
  const { error } = await sb.from("messages")
    .update({
      deleted: true, text: "",
      image: null, audio: null, audio_duration: null,
      reply_to: null
    }).eq("id", mid);
  if (error) showErr("حذف نشد: " + error.message);
};

/* ================= 🔍 جستجو در گفتگو (جدید) ================= */

let searchHits = [];
let searchIdx = -1;
let searchQ = "";

function clearSearchHits() {
  document.querySelectorAll("#messages .search-hit, #messages .search-hit-active")
    .forEach(el => el.classList.remove("search-hit", "search-hit-active"));
}

window.toggleSearch = function () {
  const bar = document.getElementById("search-bar");
  if (!bar) return;
  if (bar.style.display === "none" || !bar.style.display) {
    bar.style.display = "flex";
    document.body.classList.add("searching");
    const si = document.getElementById("search-input");
    si.value = searchQ || "";
    si.focus();
    if (searchQ) window.onCSearch(si, false);
  } else {
    closeSearch();
  }
};

window.closeSearch = function () {
  const bar = document.getElementById("search-bar");
  if (bar) bar.style.display = "none";
  document.body.classList.remove("searching");
  clearSearchHits();
  searchHits = [];
  searchIdx = -1;
  searchQ = "";
  const c = document.getElementById("search-count");
  if (c) c.textContent = "";
};

window.onCSearch = function (el, isEnter) {
  const q = (el.value || "").trim().toLowerCase();
  searchQ = q;
  clearSearchHits();
  searchHits = [];
  searchIdx = -1;
  const counter = document.getElementById("search-count");
  if (counter) counter.textContent = "";
  if (!q) return;

  const mids = Object.keys(messagesCache)
    .filter(mid => {
      const d = messagesCache[mid];
      return !d.deleted && (d.text || "").toLowerCase().includes(q);
    })
    .sort((a, b) => (messagesCache[a].time || 0) - (messagesCache[b].time || 0));

  if (!mids.length) {
    if (counter) counter.textContent = "پیدا نشد";
    return;
  }

  searchHits = mids;
  mids.forEach(mid => {
    const elm = document.querySelector(`#messages [data-mid="${mid}"]`);
    if (elm) elm.classList.add("search-hit");
  });

  gotoSearch(mids.length - 1);

  if (isEnter && searchHits.length > 1) {
    gotoSearch(searchIdx + 1);
  }
};

function gotoSearch(idx) {
  if (!searchHits.length) return;
  const cur = document.querySelector("#messages .search-hit-active");
  if (cur) cur.classList.remove("search-hit-active");
  searchIdx = ((idx % searchHits.length) + searchHits.length) % searchHits.length;
  const mid = searchHits[searchIdx];
  const elm = document.querySelector(`#messages [data-mid="${mid}"]`);
  if (elm) {
    elm.classList.add("search-hit-active");
    jumpTo(mid);
  }
  const counter = document.getElementById("search-count");
  if (counter) counter.textContent = (searchIdx + 1) + " از " + searchHits.length;
}

window.searchNext = function () { gotoSearch(searchIdx + 1); };
window.searchPrev = function () { gotoSearch(searchIdx - 1); };

start();

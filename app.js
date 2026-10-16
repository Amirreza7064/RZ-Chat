import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  doc, getDoc, setDoc, updateDoc, deleteField, arrayUnion, arrayRemove,
  where, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let myName = "کاربر";
let chatId = new URLSearchParams(location.search).get("id");
let chatData = null;
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
  showErr((r && (r.code || r.message)) || String(r));
});

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function renderAvatar(el, data) {
  if (!el) return;
  if (data && data.photo) {
    el.innerHTML = `<img src="${data.photo}" alt="">`;
  } else {
    el.textContent = ((data && data.name) || "؟").charAt(0);
  }
}

function avatarHTML(data) {
  const t = document.createElement("div");
  renderAvatar(t, data);
  return t.innerHTML;
}

async function getUserInfo(uid) {
  if (userCache[uid]) return userCache[uid];
  const s = await getDoc(doc(db, "users", uid));
  const d = s.exists() ? s.data() : { name: "کاربر" };
  userCache[uid] = d;
  return d;
}

function renderChatAvatar(el, c) {
  if (!el) return;
  if (c && c.photo) {
    el.innerHTML = `<img src="${c.photo}" alt="">`;
  } else {
    el.textContent = (c && c.type === "channel") ? "📢" : "👥";
  }
}

function setChatIcon(c) { renderChatAvatar(document.getElementById("chat-icon"), c); }

function updateSub() {
  const el = document.getElementById("chat-sub");
  if (!el || !chatData) return;

  if (isSaved) {
    el.textContent = "فقط برای خودت";
    return;
  }

  // ✍️ «در حال نوشتن...»
  const typing = chatData.typing || {};
  const now = Date.now();
  const writing = Object.entries(typing).find(([uid, ts]) =>
    uid !== currentUser.uid && (now - ts) < 5000
  );
  if (writing) {
    el.textContent = "✍️ در حال نوشتن...";
    return;
  }

  if (isPrivate) {
    const members = chatData.members || [];
    const otherUid = members.find(u => u !== currentUser.uid);
    const info = otherUid ? userCache[otherUid] : null;
    el.textContent = (info && info.username) ? "@" + info.username : "چت خصوصی";
    return;
  }

  el.textContent = (chatData.type === "channel" ? "کانال" : "گروه")
    + " • " + (chatData.members || []).length + " عضو";
}

function markAsRead() {
  if (!currentUser || !chatId) return;
  setDoc(doc(db, "users", currentUser.uid, "chatMeta", chatId), {
    lastReadTime: Date.now(), markUnread: false
  }, { merge: true }).catch(() => {});
}

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

function showComposer() {
  document.getElementById("composer").style.display = "block";
  document.getElementById("send-box").style.display = "flex";
}

function previewOf(d) {
  if (d.deleted) return "🚫 حذف شده";
  if (d.image) return "🖼 عکس";
  if (d.audio) return "🎤 پیام صوتی";
  return (d.text || "").slice(0, 80);
}

/* ================= شروع ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;
  if (!chatId) { location.href = "chats.html"; return; }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    myName = userSnap.exists() ? (userSnap.data().name || "کاربر") : "کاربر";

    const chatSnap = await getDoc(doc(db, "chats", chatId));
    if (!chatSnap.exists()) {
      alert("این چت وجود ندارد");
      location.href = "chats.html";
      return;
    }
    chatData = chatSnap.data();

    if (chatData.type === "saved") {
      isSaved = true;
      document.getElementById("chat-icon").textContent = "🔖";
      document.getElementById("chat-title").textContent = "پیام‌های ذخیره‌شده";
      updateSub();
      showComposer();

    } else if (chatData.type === "private") {
      isPrivate = true;
      const members = chatData.members || [];
      if (!members.includes(currentUser.uid)) {
        alert("این چت مال تو نیست ❌");
        location.href = "chats.html";
        return;
      }
      const otherUid = members.find(u => u !== currentUser.uid);
      const other = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
      renderAvatar(document.getElementById("chat-icon"), other);
      document.getElementById("chat-title").textContent = other.name || "کاربر";
      updateSub();
      showComposer();

    } else {
      const members = chatData.members || [];
      isAdmin = (chatData.admins || []).includes(currentUser.uid);
      const isMember = members.includes(currentUser.uid);

      document.getElementById("chat-title").textContent = chatData.name;
      setChatIcon(chatData);
      updateSub();

      if (!isMember) {
        document.getElementById("join-text").textContent =
          chatData.type === "channel"
            ? "برای دنبال کردن این کانال عضو شو:"
            : "برای ارسال پیام در این گروه عضو شو:";
        document.getElementById("join-bar").style.display = "flex";
      } else {
        if (chatData.type !== "channel" || isAdmin) {
          showComposer();
        }
        document.getElementById("invite-btn").style.display = "inline-block";
      }
      document.getElementById("chat-header").style.cursor = "pointer";
      document.getElementById("chat-header").onclick = openInfo;
    }

    // شنونده زنده چت → تایپ و تغییرات گروه
    if (!isSaved) {
      onSnapshot(doc(db, "chats", chatId), (snap) => {
        if (!snap.exists()) return;
        chatData = snap.data();
        updateSub();
      });
    }

    // شنونده ورودی تایپ
    document.getElementById("messageInput").addEventListener("input", setTyping);

    markAsRead();
    listenMessages();
  } catch (e) {
    showErr("خطای بارگذاری: " + (e.code || e.message));
  }
});

/* ================= ✍️ در حال نوشتن ================= */

function setTyping() {
  if (!currentUser || isSaved) return;
  if (chatData && chatData.type === "channel" && !isAdmin) return;

  const now = Date.now();
  if (now - typingLast < 2000) return; // هر ۲ ثانیه یک بار
  typingLast = now;

  updateDoc(doc(db, "chats", chatId), {
    ["typing." + currentUser.uid]: now
  }).catch(() => {});

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTyping, 6000);
}

async function clearTyping() {
  if (!currentUser || !chatId || isSaved) return;
  try {
    await updateDoc(doc(db, "chats", chatId), {
      ["typing." + currentUser.uid]: deleteField()
    });
  } catch (e) { /* ignore */ }
}

/* ================= پروفایل چت ================= */

window.openInfo = async function () {
  if (!chatData || isPrivate || isSaved) return;
  document.getElementById("info-modal").classList.add("show");
  document.getElementById("info-modal-title").textContent =
    chatData.type === "channel" ? "اطلاعات کانال" : "اطلاعات گروه";

  renderChatAvatar(document.getElementById("info-avatar"), chatData);
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
          <div class="chat-name">${escapeHTML(info.name || "کاربر")}${uid === currentUser.uid ? " (تو)" : ""}</div>
          <div class="chat-last">${info.username ? "@" + escapeHTML(info.username) : ""}</div>
        </div>
        ${admins.includes(uid) ? '<span class="crown">👑</span>' : ""}
        ${isAdmin && uid !== currentUser.uid && uid !== chatData.createdBy
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
    const s = await getDoc(doc(db, "usernames", q.slice(1)));
    if (s.exists()) uid = s.data().uid;
  } else if (/^(\+98|98|0)?9\d{9}$/.test(q.replace(/\s/g, ""))) {
    let p = q.replace(/\D/g, "");
    if (p.startsWith("98")) p = "0" + p.slice(2);
    if (p.length === 10) p = "0" + p;
    const s = await getDoc(doc(db, "phones", p));
    if (s.exists()) uid = s.data().uid;
  } else if (q.includes("@")) {
    const qs = await getDocs(query(collection(db, "users"), where("email", "==", q), limit(1)));
    if (!qs.empty) uid = qs.docs[0].id;
  }

  if (!uid) { alert("پیدا نشد ❌"); return; }
  if ((chatData.members || []).includes(uid)) { alert("از قبل عضوه"); return; }

  await updateDoc(doc(db, "chats", chatId), { members: arrayUnion(uid) });
  chatData.members = [...(chatData.members || []), uid];
  document.getElementById("add-member-q").value = "";
  await renderMembers();
  updateSub();
};

window.removeMember = async function (uid) {
  if (!confirm("این عضو حذف شود؟")) return;
  await updateDoc(doc(db, "chats", chatId), { members: arrayRemove(uid) });
  chatData.members = (chatData.members || []).filter(u => u !== uid);
  await renderMembers();
  updateSub();
};

window.saveChatInfo = async function () {
  const name = document.getElementById("info-name").value.trim();
  const description = document.getElementById("info-desc").value.trim();
  if (!name) { alert("نام نمی‌تواند خالی باشد"); return; }
  await updateDoc(doc(db, "chats", chatId), { name, description });
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
        await updateDoc(doc(db, "chats", chatId), { photo: dataUrl });
        chatData.photo = dataUrl;
        setChatIcon(chatData);
        renderChatAvatar(document.getElementById("info-avatar"), chatData);
        alert("عکس ذخیره شد ✅");
      } catch (err) {
        showErr("خطای ذخیره عکس: " + (err.code || err.message));
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
  if (!currentUser || !chatData) return;
  try {
    await updateDoc(doc(db, "chats", chatId), { members: arrayUnion(currentUser.uid) });
    location.reload();
  } catch (e) {
    console.error(e);
    alert("عضویت ناموفق بود");
  }
};

/* ================= ↩️ پاسخ ================= */

window.replyTo = function (mid) {
  const d = messagesCache[mid];
  if (!d) return;
  replyState = {
    mid: mid,
    name: d.senderName || "کاربر",
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
  const cur = (d.reactions || {})[currentUser.uid];
  const ref = doc(db, "chats", chatId, "messages", mid);
  try {
    if (cur === emoji) {
      await updateDoc(ref, { ["reactions." + currentUser.uid]: deleteField() });
    } else {
      await updateDoc(ref, { ["reactions." + currentUser.uid]: emoji });
    }
  } catch (e) {
    showErr("واکنش ثبت نشد: " + (e.code || e.message));
  }
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

  try {
    const qs = await getDocs(
      query(collection(db, "chats"), where("members", "array-contains", currentUser.uid))
    );

    let html = "";
    for (const dd of qs.docs) {
      const c = dd.data();
      let icon, title;

      if (c.type === "saved") {
        icon = "🔖";
        title = "پیام‌های ذخیره‌شده";
      } else if (c.type === "private") {
        const otherUid = (c.members || []).find(u => u !== currentUser.uid);
        const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
        icon = avatarHTML(info);
        title = info.name || "کاربر";
      } else {
        if (c.type === "channel" && !(c.admins || []).includes(currentUser.uid)) continue;
        icon = c.type === "channel" ? "📢" : "👥";
        title = c.name || "چت";
      }

      html += `
        <div class="fw-item" onclick="doForward('${dd.id}')">
          <div class="avatar">${icon}</div>
          <div>${escapeHTML(title)}</div>
        </div>`;
    }

    if (!html) html = "<p class='hint'>چتی برای فوروارد نیست</p>";
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = "<p class='hint'>خطا</p>";
  }
}

window.doForward = async function (targetId) {
  const d = messagesCache[fwMid];
  if (!d || d.deleted) return;

  const nd = {
    senderName: d.senderName || myName,
    uid: currentUser.uid,
    time: Date.now(),
    forwarded: true
  };
  if (d.text) nd.text = d.text;
  if (d.image) nd.image = d.image;
  if (d.audio) { nd.audio = d.audio; nd.audioDuration = d.audioDuration || 0; }

  try {
    await addDoc(collection(db, "chats", targetId, "messages"), nd);
    await updateDoc(doc(db, "chats", targetId), {
      lastMessage: "↪️ " + previewOf(d),
      lastMessageTime: Date.now(),
      lastMessageSender: currentUser.uid
    });
    closeForward();
    alert("فوروارد شد ✅");
  } catch (e) {
    showErr("فوروارد نشد: " + (e.code || e.message));
  }
};

/* ================= ارسال پیام متنی ================= */

async function sendMessage() {
  if (!chatData || !currentUser) return;
  if (!isPrivate && !isSaved && chatData.type === "channel" && !isAdmin) return;

  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  const msg = {
    text: text, senderName: myName, uid: currentUser.uid, time: Date.now()
  };
  if (replyState) {
    msg.replyTo = {
      mid: replyState.mid,
      name: replyState.name,
      text: replyState.preview
    };
  }

  await addDoc(collection(db, "chats", chatId, "messages"), msg);

  updateDoc(doc(db, "chats", chatId), {
    lastMessage: text, lastMessageTime: Date.now(), lastMessageSender: currentUser.uid
  });

  input.value = "";
  input.focus();
  cancelReply();
  clearTyping();
}

window.sendMessage = sendMessage;

/* ================= ارسال عکس ================= */

window.sendImage = function (input) {
  const file = input.files[0];
  if (!file || !currentUser) return;

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
          text: "", image: dataUrl, senderName: myName, uid: currentUser.uid, time: Date.now()
        };
        if (replyState) {
          msg.replyTo = {
            mid: replyState.mid, name: replyState.name, text: replyState.preview
          };
        }

        await addDoc(collection(db, "chats", chatId, "messages"), msg);
        updateDoc(doc(db, "chats", chatId), {
          lastMessage: "🖼 عکس", lastMessageTime: Date.now(), lastMessageSender: currentUser.uid
        });
        cancelReply();
      } catch (err) {
        showErr("خطای ارسال عکس: " + (err.code || err.message));
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
  if (!chatData || !currentUser) return;
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
          text: "", audio: ev.target.result, audioDuration: recSeconds,
          senderName: myName, uid: currentUser.uid, time: Date.now()
        };
        if (replyState) {
          msg.replyTo = {
            mid: replyState.mid, name: replyState.name, text: replyState.preview
          };
        }
        await addDoc(collection(db, "chats", chatId, "messages"), msg);
        updateDoc(doc(db, "chats", chatId), {
          lastMessage: "🎤 پیام صوتی", lastMessageTime: Date.now(),
          lastMessageSender: currentUser.uid
        });
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
        : ((messagesCache[mid] || {}).audioDuration || 1);
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

function listenMessages() {
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("time"));

  onSnapshot(q, (snapshot) => {
    const box = document.getElementById("messages");
    box.innerHTML = "";
    messagesCache = {};

    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      const mid = docSnap.id;
      messagesCache[mid] = d;

      const mine = d.uid === currentUser.uid;
      const time = new Date(d.time).toLocaleTimeString("fa-IR", {
        hour: "2-digit", minute: "2-digit"
      });

      let inner = "";
      if (d.deleted) {
        inner = `<div class="text deleted-msg">🚫 این پیام حذف شده است</div>`;
      } else {
        // پاسخ
        if (d.replyTo) {
          inner += `
            <div class="reply-box" onclick="jumpTo('${d.replyTo.mid}')">
              <div class="reply-name">${escapeHTML(d.replyTo.name)}</div>
              <div class="reply-text">${escapeHTML(d.replyTo.text || "")}</div>
            </div>`;
        }
        if (d.image) inner += `<img class="msg-img" src="${d.image}" alt="عکس">`;
        if (d.audio) inner += `
          <div class="voice-row">
            <button class="vplay" onclick="vplay(this,'${mid}')">▶</button>
            <div class="wave" id="wave-${mid}">${barsHTML(hashSeed(mid))}</div>
            <span class="voice-dur">${fmtDur(d.audioDuration || 0)}</span>
            <audio id="aud-${mid}" src="${d.audio}" preload="none" style="display:none"></audio>
          </div>`;
        if (d.text) inner += `<div class="text">${escapeHTML(d.text)}</div>`;
      }

      const senderHtml = (!mine && !isPrivate && !isSaved)
        ? `<div class="sender">${escapeHTML(d.senderName || "ناشناس")}</div>` : "";

      const fwdTag = d.forwarded ? '<span class="fwd-tag">↪️ فوروارد</span>' : "";

      const editedTag = (d.edited && !d.deleted)
        ? '<span class="edited"> (ویرایش‌شده)</span>' : "";

      // ری‌اکشن‌ها
      let rHtml = "";
      if (!d.deleted && d.reactions) {
        const groups = {};
        Object.entries(d.reactions).forEach(([uid, e]) => {
          (groups[e] = groups[e] || []).push(uid);
        });
        for (const [e, uids] of Object.entries(groups)) {
          const mineR = uids.includes(currentUser.uid);
          rHtml += `<span class="rchip ${mineR ? "mine" : ""}" onclick="toggleReaction('${mid}','${e}')">${e}${uids.length > 1 ? " " + uids.length : ""}</span>`;
        }
      }

      box.innerHTML += `
        <div class="message ${mine ? "mine" : ""}" data-mid="${mid}">
          ${senderHtml}
          ${fwdTag}
          ${inner}
          <div class="time">${time}${editedTag}</div>
          ${rHtml ? `<div class="rbar">${rHtml}</div>` : ""}
        </div>`;
    });

    box.scrollTop = box.scrollHeight;
    markAsRead();
  }, (err) => showErr("خطای پیام‌ها: " + err.code));
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

  const mine = d.uid === currentUser.uid;
  let html = "";

  // ردیف ری‌اکشن‌ها
  html += `<div class="react-row">${["👍", "❤️", "😂", "😮", "😢"]
    .map(e => `<button onclick="reactFromMenu('${mid}','${e}')">${e}</button>`).join("")}</div>`;

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
  await updateDoc(doc(db, "chats", chatId, "messages", mid), { text: nt, edited: true });
};

window.deleteMsg = async function (mid) {
  if (!confirm("این پیام حذف شود؟")) return;
  await updateDoc(doc(db, "chats", chatId, "messages", mid), {
    deleted: true, text: "",
    image: deleteField(), audio: deleteField(), audioDuration: deleteField(),
    replyTo: deleteField()
  });
};

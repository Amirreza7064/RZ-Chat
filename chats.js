import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, limit, getDocs,
  onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc,
  arrayRemove, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;
let myData = {};
let chatsMap = {};     // chatId -> اطلاعات چت
let metaMap = {};      // chatId -> سنجاق/بایگانی/خوانده‌نشده من
let currentView = "main"; // "main" یا "archived"
const userCache = {};

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

/* ---------- نمایش خطا ---------- */

const errBanner = document.createElement("div");
errBanner.style.cssText =
  "display:none;background:#c0392b;color:#fff;padding:10px 15px;" +
  "font-size:13px;font-family:tahoma;position:fixed;top:0;right:0;left:0;" +
  "z-index:999;direction:rtl;text-align:center";
document.body.appendChild(errBanner);

function showErr(msg) {
  console.error("RZ-Chat:", msg);
  errBanner.style.display = "block";
  errBanner.textContent = "⚠️ " + msg;
}

window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  showErr((r && (r.code || r.message)) || String(r));
});

/* ---------- ابزارها ---------- */

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
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
  const tmp = document.createElement("div");
  renderAvatar(tmp, data);
  return tmp.innerHTML;
}

async function getUserInfo(uid) {
  if (userCache[uid]) return userCache[uid];
  const s = await getDoc(doc(db, "users", uid));
  const d = s.exists() ? s.data() : { name: "کاربر" };
  userCache[uid] = d;
  return d;
}

function timeStr(t) {
  if (!t) return "";
  return new Date(t).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

const lastTime = (chat) => chat.lastMessageTime || chat.createdAt || 0;
const byNewest = (a, b) => lastTime(b[1]) - lastTime(a[1]);

/* ---------- شروع ---------- */

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      location.href = "index.html";
      return;
    }
    me = user;

    const required = ["my-avatar", "user-name", "chat-list", "contact-list",
                      "set-name", "set-username", "set-bio", "set-avatar",
                      "info-email", "info-phone", "dark-toggle", "ctx-menu"];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
      showErr("فایل chats.html قدیمی است! نسخه جدید را در ریپو بگذار. (گم‌شده: " + missing.join(", ") + ")");
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));
    myData = snap.exists() ? snap.data() : {};

    renderAvatar(document.getElementById("my-avatar"), myData);
    document.getElementById("user-name").textContent = myData.name || "کاربر";

    document.getElementById("set-name").value = myData.name || "";
    document.getElementById("set-username").value = myData.username || "";
    document.getElementById("set-bio").value = myData.bio || "";
    renderAvatar(document.getElementById("set-avatar"), myData);
    document.getElementById("info-email").textContent = myData.email || "—";
    document.getElementById("info-phone").textContent = myData.phone || "—";
    document.getElementById("dark-toggle").checked =
      localStorage.getItem("dark") === "1";

    // ساخت «پیام‌های ذخیره‌شده» اگر وجود ندارد (merge → چیزی پاک نمی‌شود)
    await setDoc(doc(db, "chats", "saved_" + user.uid), {
      type: "saved",
      members: [user.uid],
      createdBy: user.uid,
      lastMessage: "",
      lastMessageTime: 0,
      createdAt: Date.now()
    }, { merge: true });

    listenChats();
    listenMeta();
    listenContacts();

  } catch (e) {
    showErr("خطای بارگذاری: " + (e.code || e.message));
  }
});

/* ---------- شنونده‌ها ---------- */

function listenChats() {
  const q = query(collection(db, "chats"), where("members", "array-contains", me.uid));
  onSnapshot(q, (snap) => {
    chatsMap = {};
    snap.forEach(d => { chatsMap[d.id] = d.data(); });
    render();
  }, (err) => showErr("خطای دیتابیس (چت‌ها): " + err.code));
}

function listenMeta() {
  const q = collection(db, "users", me.uid, "chatMeta");
  onSnapshot(q, (snap) => {
    metaMap = {};
    snap.forEach(d => { metaMap[d.id] = d.data(); });
    render();
  }, (err) => showErr("خطای دیتابیس (متادیتا): " + err.code));
}

function listenContacts() {
  const list = document.getElementById("contact-list");
  list.innerHTML = "<p class='empty'>⏳ در حال بارگذاری مخاطبین...</p>";

  const q = collection(db, "users", me.uid, "contacts");
  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      list.innerHTML = "<p class='empty'>مخاطبی نداری! دکمه ＋ پایین را بزن</p>";
      return;
    }
    let html = "";
    snapshot.forEach((docSnap) => {
      const c = docSnap.data();
      html += `
        <div class="chat-item" onclick="openPrivateChat('${docSnap.id}')">
          <div class="avatar">${avatarHTML(c)}</div>
          <div>
            <div class="chat-name">${escapeHTML(c.name)}</div>
            <div class="chat-last">${c.username ? "@" + escapeHTML(c.username) : "چت خصوصی"}</div>
          </div>
        </div>`;
    });
    list.innerHTML = html;
  }, (err) => showErr("خطای دیتابیس (مخاطبین): " + err.code));
}

/* ---------- رندر لیست چت‌ها ---------- */

async function render() {
  const list = document.getElementById("chat-list");
  const entries = Object.entries(chatsMap);

  const saved = entries.find(([id]) => id === "saved_" + me.uid);
  const rest = entries.filter(([id]) => id !== "saved_" + me.uid);

  const archived = rest.filter(([id]) => (metaMap[id] || {}).archived);
  const pinned   = rest.filter(([id]) => (metaMap[id] || {}).pinned && !(metaMap[id] || {}).archived);
  const normal   = rest.filter(([id]) => !(metaMap[id] || {}).pinned && !(metaMap[id] || {}).archived);

  pinned.sort(byNewest);
  normal.sort(byNewest);
  archived.sort(byNewest);

  let html = "";

  if (currentView === "archived") {
    html += `
      <div class="chat-item archive-row" onclick="showMainView()">
        <div class="avatar">→</div>
        <div><div class="chat-name">بازگشت به چت‌ها</div></div>
      </div>`;

    if (archived.length === 0) {
      html += "<p class='empty'>بایگانی خالی است</p>";
    }
    for (const [id, chat] of archived) {
      html += await itemHTML(id, chat);
    }

  } else {
    // 🔖 پیام‌های ذخیره‌شده — همیشه اول
    if (saved) {
      const c = saved[1];
      html += `
        <div class="chat-item saved-row" data-chat="${saved[0]}" onclick="openChat('${saved[0]}')">
          <div class="avatar">🔖</div>
          <div>
            <div class="chat-name">پیام‌های ذخیره‌شده</div>
            <div class="chat-last">${escapeHTML(c.lastMessage || "پیام‌های خودت اینجاست...")}</div>
          </div>
        </div>`;
    }

    // 📌 سنجاق‌شده‌ها
    for (const [id, chat] of pinned) {
      html += await itemHTML(id, chat);
    }

    // 📤 پوشه بایگانی
    if (archived.length > 0) {
      html += `
        <div class="chat-item archive-row" onclick="showArchivedView()">
          <div class="avatar">📤</div>
          <div>
            <div class="chat-name">بایگانی‌شده‌ها</div>
            <div class="chat-last">${archived.length} چت</div>
          </div>
        </div>`;
    }

    for (const [id, chat] of normal) {
      html += await itemHTML(id, chat);
    }

    if (!saved && entries.length === 0) {
      html = "<p class='empty'>چتی نداری! دکمه ＋ پایین را بزن 👇</p>";
    }
  }

  list.innerHTML = html;
  updateBadges();
}

async function itemHTML(id, chat) {
  const meta = metaMap[id] || {};
  let iconHtml, title;

  if (chat.type === "private") {
    const otherUid = (chat.members || []).find(u => u !== me.uid);
    const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
    iconHtml = avatarHTML(info);
    title = info.name || "کاربر";
  } else {
    iconHtml = chat.type === "channel" ? "📢" : "👥";
    title = chat.name || "چت";
  }

  const pin = meta.pinned ? '<span class="pin-ic">📌</span>' : "";

  return `
    <div class="chat-item" data-chat="${id}" onclick="openChat('${id}')">
      <div class="avatar">${iconHtml}</div>
      <div class="chat-mid">
        <div class="chat-name">${pin}${escapeHTML(title)}</div>
        <div class="chat-last">${escapeHTML(chat.lastMessage || "...")}</div>
      </div>
      <div class="chat-side">
        <div class="chat-time">${timeStr(lastTime(chat))}</div>
        <span class="dot" id="dot-${id}" style="display:none"></span>
        <span class="badge" id="bd-${id}" style="display:none"></span>
      </div>
    </div>`;
}

/* ---------- شمارنده پیام خوانده‌نشده ---------- */

async function updateBadges() {
  const items = document.querySelectorAll("#chat-list .chat-item[data-chat]");
  for (const item of items) {
    const id = item.getAttribute("data-chat");
    const chat = chatsMap[id];
    const meta = metaMap[id] || {};
    if (!chat) continue;

    const dotEl = document.getElementById("dot-" + id);
    const bdEl = document.getElementById("bd-" + id);
    if (!dotEl || !bdEl) continue;

    let count = 0;
    const lastRead = meta.lastReadTime || 0;

    if (lastTime(chat) > lastRead) {
      try {
        const snap = await getCountFromServer(
          query(collection(db, "chats", id, "messages"), where("time", ">", lastRead))
        );
        count = snap.data().count;
      } catch (e) { /* بی‌خیال شمارش */ }
    }

    if (meta.markUnread) {
      dotEl.style.display = "inline-block";
      bdEl.style.display = "none";
    } else if (count > 0) {
      bdEl.style.display = "flex";
      bdEl.textContent = count > 99 ? "99+" : count;
      dotEl.style.display = "none";
    } else {
      bdEl.style.display = "none";
      dotEl.style.display = "none";
    }
  }
}

/* ---------- منوی راست‌کلیک ---------- */

const ctxMenu = document.getElementById("ctx-menu");

document.addEventListener("contextmenu", (e) => {
  const item = e.target.closest("#chat-list .chat-item[data-chat]");
  if (!item) { ctxMenu.style.display = "none"; return; }
  e.preventDefault();

  const id = item.getAttribute("data-chat");
  const chat = chatsMap[id];
  const meta = metaMap[id] || {};
  if (!chat || chat.type === "saved") return; // برای ذخیره‌شده‌ها منو نداریم

  let html = "";

  if (!meta.archived) {
    html += meta.pinned
      ? `<button onclick="ctxUnpin('${id}')">📍 برداشتن سنجاق</button>`
      : `<button onclick="ctxPin('${id}')">📌 سنجاق کردن</button>`;
  }

  html += meta.archived
    ? `<button onclick="ctxUnarchive('${id}')">📤 خروج از بایگانی</button>`
    : `<button onclick="ctxArchive('${id}')">📥 بایگانی کردن</button>`;

  html += meta.markUnread
    ? `<button onclick="ctxMarkRead('${id}')">✅ علامت‌گذاری به عنوان خوانده‌شده</button>`
    : `<button onclick="ctxMarkUnread('${id}')">🔵 علامت‌گذاری به عنوان خوانده‌نشده</button>`;

  html += `<button class="danger" onclick="ctxDelete('${id}')">🗑 حذف چت</button>`;

  ctxMenu.innerHTML = html;
  ctxMenu.style.display = "block";

  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + "px";
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + "px";
});

document.addEventListener("click", () => { ctxMenu.style.display = "none"; });
document.addEventListener("scroll", () => { ctxMenu.style.display = "none"; }, true);

async function setMeta(chatId, fields) {
  await setDoc(doc(db, "users", me.uid, "chatMeta", chatId), fields, { merge: true });
}

window.ctxPin       = (id) => setMeta(id, { pinned: true, pinnedAt: Date.now() });
window.ctxUnpin     = (id) => setMeta(id, { pinned: false });
window.ctxArchive   = (id) => setMeta(id, { archived: true });
window.ctxUnarchive = (id) => setMeta(id, { archived: false });
window.ctxMarkUnread = (id) => setMeta(id, { markUnread: true });
window.ctxMarkRead  = (id) => setMeta(id, { markUnread: false });

window.ctxDelete = async function (id) {
  const chat = chatsMap[id];
  if (!chat) return;
  const msg = chat.type === "private"
    ? "این چت برای تو حذف شود؟ (برای طرف مقابل باقی می‌ماند)"
    : "از این گروه/کانال خارج شوی؟";
  if (!confirm(msg)) return;

  await updateDoc(doc(db, "chats", id), { members: arrayRemove(me.uid) });
  await deleteDoc(doc(db, "users", me.uid, "chatMeta", id));
};

/* ---------- ناوبری ---------- */

window.openChat = function (id) {
  location.href = "chat.html?id=" + id;
};

window.showArchivedView = function () { currentView = "archived"; render(); };
window.showMainView = function () { currentView = "main"; render(); };

window.showTab = function (tab) {
  document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById("tab-" + tab);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);
};

window.logout = async function () {
  await signOut(auth);
  location.href = "index.html";
};

/* ---------- چت خصوصی از مخاطبین ---------- */

window.openPrivateChat = async function (contactUid) {
  const key = [me.uid, contactUid].sort().join("_");
  const chatId = "private_" + key;
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      type: "private",
      members: [me.uid, contactUid],
      createdBy: me.uid,
      lastMessage: "",
      lastMessageTime: 0,
      createdAt: Date.now()
    });
  }
  location.href = "chat.html?id=" + chatId;
};

/* ---------- مودال افزودن مخاطب ---------- */

window.openAddContact = function () {
  document.getElementById("add-modal").classList.add("show");
  document.getElementById("add-query").value = "";
  document.getElementById("add-result").innerHTML = "";
  document.getElementById("add-query").focus();
};

window.closeAddContact = function () {
  document.getElementById("add-modal").classList.remove("show");
};

window.searchContact = async function () {
  const q = document.getElementById("add-query").value.trim().toLowerCase();
  const resultDiv = document.getElementById("add-result");

  if (!q) { resultDiv.innerHTML = ""; return; }
  resultDiv.innerHTML = "<p class='hint'>در حال جستجو...</p>";

  try {
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
      const qs = await getDocs(
        query(collection(db, "users"), where("email", "==", q), limit(1))
      );
      if (!qs.empty) uid = qs.docs[0].id;
    }

    if (!uid) {
      resultDiv.innerHTML = "<p class='hint'>پیدا نشد ❌</p>";
      return;
    }
    if (uid === me.uid) {
      resultDiv.innerHTML = "<p class='hint'>این خودتی! 😄</p>";
      return;
    }

    const us = await getDoc(doc(db, "users", uid));
    const data = us.data() || { name: "کاربر" };

    resultDiv.innerHTML = `
      <div class="found-user">
        <div class="chat-item">
          <div class="avatar">${avatarHTML(data)}</div>
          <div>
            <div class="chat-name">${escapeHTML(data.name || "کاربر")}</div>
            <div class="chat-last">${data.username ? "@" + escapeHTML(data.username) : ""}</div>
          </div>
        </div>
        <button id="add-btn">افزودن به مخاطبین ➕</button>
      </div>`;

    document.getElementById("add-btn").onclick = async () => {
      await setDoc(doc(db, "users", me.uid, "contacts", uid), {
        uid: uid,
        name: data.name || "کاربر",
        username: data.username || "",
        photo: data.photo || ""
      });
      resultDiv.innerHTML = "<

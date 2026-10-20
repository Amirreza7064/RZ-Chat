import { sb, initAuth, doLogout, escapeHTML, renderAvatar, avatarHTML, getUserInfo, getMyId, getMe } from './auth.js';

let myId = null;
let myData = {};
let chatsMap = {};
let metaMap = {};
let contactsMap = {};
let currentView = "main";
const userCache = {};

let prevTimes = {};
let firstChatsLoad = true;
let chatsThrottle = false;

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

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
  showErr((r && (r.message || r.code)) || String(r));
});

function timeStr(t) {
  if (!t) return "";
  return new Date(t).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

const lastTime = (chat) => chat.last_message_time || chat.created_at || 0;
const byNewest = (a, b) => lastTime(b[1]) - lastTime(a[1]);

/* ---------- شروع ---------- */

/* 🟢 حضور آنلاین */
async function heartbeat() {
  if (!myId) return;
  sb.from("profiles").update({ last_seen: Date.now() })
    .eq("id", myId).then(() => {}, () => {});
}

async function start() {
  if (!await initAuth()) return;
  myId = getMyId();

  /* 🟢 هر ۳۰ ثانیه خودم را آنلاین نشان بده */
  heartbeat();
  setInterval(heartbeat, 30000);
  myData = getMe();

  const required = ["my-avatar", "user-name", "chat-list", "contact-list",
                    "set-name", "set-username", "set-bio", "set-avatar",
                    "info-email", "info-phone", "dark-toggle", "ctx-menu"];
  const missing = required.filter(id => !document.getElementById(id));
  if (missing.length > 0) {
    showErr("chats.html قدیمی است! (گم‌شده: " + missing.join(", ") + ")");
    return;
  }

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

  await ensureSaved();

  await loadChats();
  loadMeta();
  loadContacts();

  sb.channel("chats-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "chats" },
      () => scheduleChatsReload())
    .subscribe();

  sb.channel("meta-" + myId)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "chat_meta", filter: "user_id=eq." + myId },
      () => loadMeta())
    .subscribe();

  sb.channel("contacts-" + myId)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "contacts", filter: "owner=eq." + myId },
      () => loadContacts())
    .subscribe();
}

function scheduleChatsReload() {
  if (chatsThrottle) return;
  chatsThrottle = true;
  setTimeout(() => { chatsThrottle = false; loadChats(); }, 400);
}

async function ensureSaved() {
  const { data } = await sb.from("chats").select("id")
    .eq("type", "saved").eq("created_by", myId).maybeSingle();
  if (!data) {
    await sb.from("chats").insert({
      type: "saved", members: [myId], admins: [myId],
      created_by: myId, name: "پیام‌های ذخیره‌شده"
    });
  }
}

/* ---------- بارگذاری‌ها ---------- */

async function loadChats() {
  try {
    const { data, error } = await sb.from("chats")
      .select("*").contains("members", [myId]);
    if (error) throw error;

    chatsMap = {};
    (data || []).forEach(c => { chatsMap[c.id] = c; });

    if (!firstChatsLoad) maybeNotify(chatsMap);
    firstChatsLoad = false;
    prevTimes = {};
    Object.entries(chatsMap).forEach(([id, c]) => { prevTimes[id] = c.last_message_time || 0; });

    render();
  } catch (e) {
    showErr("خطای دیتابیس (چت‌ها): " + e.message);
  }
}

async function loadMeta() {
  const { data, error } = await sb.from("chat_meta")
    .select("*").eq("user_id", myId);
  if (error) { showErr("خطای متادیتا: " + error.message); return; }

  metaMap = {};
  (data || []).forEach(m => { metaMap[m.chat_id] = m; });
  render();
}

async function loadContacts() {
  const list = document.getElementById("contact-list");
  const { data, error } = await sb.from("contacts")
    .select("*").eq("owner", myId);

  if (error) { showErr("خطای مخاطبین: " + error.message); return; }

  contactsMap = {};

  if (!data || data.length === 0) {
    list.innerHTML = "<p class='empty'>مخاطبی نداری! دکمه ＋ پایین را بزن</p>";
    return;
  }

  /* 🔍 فیلتر مخاطبین بر اساس جستجو (جدید) */
  const shown = data.filter(c => {
    if (!contactQuery) return true;
    return (c.name || "").toLowerCase().includes(contactQuery)
        || (c.username || "").toLowerCase().includes(contactQuery);
  });

  if (shown.length === 0) {
    list.innerHTML = "<p class='empty'>مخاطبی با این اسم پیدا نشد</p>";
    return;
  }

  let html = "";
  shown.forEach((c) => {
    contactsMap[c.contact] = c;
    html += `
      <div class="chat-item" data-contact="${c.contact}" onclick="openPrivateChat('${c.contact}')">
        <div class="avatar">${avatarHTML(c)}</div>
        <div>
          <div class="chat-name">${escapeHTML(c.name)}</div>
          <div class="chat-last">${c.username ? "@" + escapeHTML(c.username) : "چت خصوصی"}</div>
        </div>
      </div>`;
  });
  list.innerHTML = html;
}

/* ---------- اعلان ---------- */

async function maybeNotify(newMap) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  for (const [id, chat] of Object.entries(newMap)) {
    if (id === getSavedId()) continue;
    if ((metaMap[id] || {}).archived) continue;

    const t = chat.last_message_time || 0;
    if (t <= (prevTimes[id] || 0)) continue;
    if (!chat.last_message_sender || chat.last_message_sender === myId) continue;

    let title = chat.name || "پیام جدید";
    let body = chat.last_message || "";

    try {
      if (chat.type === "private") {
        const other = (chat.members || []).find(u => u !== myId);
        const info = await getUserInfo(other);
        title = info.name || "پیام جدید";
      } else if (chat.type === "group") {
        const s = await getUserInfo(chat.last_message_sender);
        if (s.name) body = s.name + ": " + body;
      }
    } catch (e) { /* ignore */ }

    try {
      const n = new Notification(title, { body: body });
      n.onclick = () => { window.focus(); location.href = "chat.html?id=" + id; };
    } catch (e) { /* ignore */ }
  }
}

function getSavedId() {
  for (const [id, c] of Object.entries(chatsMap)) {
    if (c.type === "saved" && c.created_by === myId) return id;
  }
  return null;
}

/* ---------- رندر ---------- */

async function render() {
  const list = document.getElementById("chat-list");
  const entries = Object.entries(chatsMap);
  const savedId = getSavedId();

  const saved = entries.find(([id]) => id === savedId);
  const rest = entries.filter(([id]) => id !== savedId);

  const archived = rest.filter(([id]) => (metaMap[id] || {}).archived);
  const pinned   = rest.filter(([id]) => (metaMap[id] || {}).pinned && !(metaMap[id] || {}).archived);
  const normal   = rest.filter(([id]) => !(metaMap[id] || {}).pinned && !(metaMap[id] || {}).archived);

  pinned.sort(byNewest);
  normal.sort(byNewest);
  archived.sort(byNewest);

  /* 🔍 اگر جستجو فعال باشد، فقط نتایج جستجو نمایش داده می‌شود (جدید) */
  if (searchQuery) {
    await renderSearchView(list, { saved, archived, pinned, normal });
    return;
  }

  let html = "";

  if (currentView === "archived") {
    html += `
      <div class="chat-item archive-row" onclick="showMainView()">
        <div class="avatar">→</div>
        <div><div class="chat-name">بازگشت به چت‌ها</div></div>
      </div>`;
    if (archived.length === 0) html += "<p class='empty'>بایگانی خالی است</p>";
    for (const [id, chat] of archived) html += await itemHTML(id, chat);

  } else {
    if (saved) {
      const c = saved[1];
      html += `
        <div class="chat-item saved-row" data-chat="${saved[0]}" onclick="openChat('${saved[0]}')">
          <div class="avatar">🔖</div>
          <div>
            <div class="chat-name">پیام‌های ذخیره‌شده</div>
            <div class="chat-last">${escapeHTML(c.last_message || "پیام‌های خودت اینجاست...")}</div>
          </div>
        </div>`;
    }

    for (const [id, chat] of pinned) html += await itemHTML(id, chat);

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

    for (const [id, chat] of normal) html += await itemHTML(id, chat);

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
    const otherUid = (chat.members || []).find(u => u !== myId);
    const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
    iconHtml = avatarHTML(info);
    title = info.name || "کاربر";
  } else if (chat.type === "saved") {
    iconHtml = "🔖";
    title = "پیام‌های ذخیره‌شده";
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
        <div class="chat-last">${escapeHTML(chat.last_message || "...")}</div>
      </div>
      <div class="chat-side">
        <div class="chat-time">${timeStr(lastTime(chat))}</div>
        <span class="dot" id="dot-${id}" style="display:none"></span>
        <span class="badge" id="bd-${id}" style="display:none"></span>
      </div>
    </div>`;
}

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
    const lastRead = meta.last_read_time || 0;

    if (lastTime(chat) > lastRead) {
      try {
        const { count: c } = await sb.from("messages")
          .select("id", { count: "exact", head: true })
          .eq("chat_id", id).gt("time", lastRead);
        count = c || 0;
      } catch (e) { /* ignore */ }
    }

    if (meta.mark_unread) {
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

/* ---------- 🔍 جستجو در چت‌ها و پیام‌ها (جدید) ---------- */

let searchQuery = "";
let searchTimer = null;
let contactQuery = "";
let msgSearchTimer = null;
let lastMsgResults = [];

function chatTitleOf(chat) {
  if (!chat) return "";
  if (chat.type === "saved") return "پیام‌های ذخیره‌شده";
  return chat.name || "چت";
}

async function chatMatches(chat, q) {
  if (chat.type === "saved") {
    return "پیام‌های ذخیره‌شده".includes(q)
      || (chat.last_message || "").toLowerCase().includes(q);
  }
  if (chat.type === "private") {
    const otherUid = (chat.members || []).find(u => u !== myId);
    if (!otherUid) return false;
    const info = await getUserInfo(otherUid);
    return ((info.name || "کاربر").toLowerCase().includes(q))
        || ((info.username || "").toLowerCase().includes(q));
  }
  return ((chat.name || "").toLowerCase().includes(q))
      || ((chat.description || "").toLowerCase().includes(q))
      || ((chat.last_message || "").toLowerCase().includes(q));
}

function hiEsc(text, q) {
  const t = escapeHTML(text || "");
  if (!q) return t;
  const eq = escapeHTML(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return t.replace(new RegExp(eq, "gi"), m => `<mark>${m}</mark>`);
  } catch (e) { return t; }
}

window.onChatSearchInput = function (el) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = (el.value || "").trim().toLowerCase();
    render();
    clearTimeout(msgSearchTimer);
    if (searchQuery.length >= 2) {
      msgSearchTimer = setTimeout(() => fetchGlobalMessages(searchQuery), 350);
    } else {
      lastMsgResults = [];
    }
  }, 250);
};

window.onContactSearchInput = function (el) {
  contactQuery = (el.value || "").trim().toLowerCase();
  loadContacts();
};

async function fetchGlobalMessages(q) {
  try {
    const ids = Object.keys(chatsMap);
    if (!ids.length) { lastMsgResults = []; render(); return; }

    const like = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const { data, error } = await sb.from("messages")
      .select("id,chat_id,text,sender_name,time")
      .in("chat_id", ids)
      .or("deleted.is.null,deleted.eq.false")
      .ilike("text", "%" + like + "%")
      .order("time", { ascending: false })
      .limit(30);

    if (error) throw error;
    lastMsgResults = (data || []).filter(m => m.text);
    render();
  } catch (e) {
    showErr("خطای جستجوی پیام‌ها: " + e.message);
  }
}

async function msgResultHTML(m) {
  const chat = chatsMap[m.chat_id];
  let title = "چت";
  if (chat) {
    if (chat.type === "private") {
      const otherUid = (chat.members || []).find(u => u !== myId);
      const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
      title = info.name || "کاربر";
    } else {
      title = chatTitleOf(chat);
    }
  }
  const t = new Date(m.time);
  const when = t.toLocaleDateString("fa-IR") + " " + timeStr(m.time);

  return `
    <div class="chat-item search-msg" onclick="openSearchMsg('${m.chat_id}','${m.id}')">
      <div class="avatar">💬</div>
      <div class="chat-mid">
        <div class="chat-name">${escapeHTML(title)}</div>
        <div class="chat-last">${escapeHTML(m.sender_name || "کاربر")}: ${hiEsc(m.text, searchQuery)}</div>
      </div>
      <div class="chat-side">
        <div class="chat-time">${when}</div>
      </div>
    </div>`;
}

window.openSearchMsg = function (cid, mid) {
  location.href = "chat.html?id=" + cid
    + "&q=" + encodeURIComponent(searchQuery)
    + "&mid=" + mid;
};

async function renderSearchView(list, parts) {
  const q = searchQuery;
  const pick = async (arr) => {
    const out = [];
    for (const [id, chat] of arr) {
      if (await chatMatches(chat, q)) out.push([id, chat]);
    }
    return out;
  };

  const mp = await pick(parts.pinned);
  const mn = await pick(parts.normal);
  const ma = await pick(parts.archived);
  const savedHit = !!(parts.saved
    && ("پیام‌های ذخیره‌شده".includes(q)
      || ((parts.saved[1].last_message || "").toLowerCase().includes(q))));

  let html = "";

  if (lastMsgResults.length > 0) {
    html += `<div class="search-sec-title">💬 پیام‌ها (${lastMsgResults.length})</div>`;
    for (const m of lastMsgResults) html += await msgResultHTML(m);
  }

  const chatHits = [...mp, ...mn, ...ma];
  if (savedHit || chatHits.length > 0) {
    html += `<div class="search-sec-title">📌 چت‌ها</div>`;
  }
  if (savedHit) html += await itemHTML(parts.saved[0], parts.saved[1]);
  for (const [id, chat] of chatHits) html += await itemHTML(id, chat);

  if (!html) html = "<p class='empty'>چیزی پیدا نشد 🤷</p>";
  list.innerHTML = html;
  updateBadges();
}

/* ---------- منوی راست‌کلیک ---------- */

const ctxMenu = document.getElementById("ctx-menu");

document.addEventListener("contextmenu", (e) => {
  const chatItem = e.target.closest("#chat-list .chat-item[data-chat]");
  const contactItem = e.target.closest("#contact-list .chat-item[data-contact]");

  if (!chatItem && !contactItem) {
    ctxMenu.style.display = "none";
    return;
  }
  e.preventDefault();

  let html = "";

  if (contactItem) {
    const uid = contactItem.getAttribute("data-contact");
    html += `<button onclick="ctxRenameContact('${uid}')">✏️ تغییر نام مخاطب</button>`;
    html += `<button class="danger" onclick="ctxRemoveContact('${uid}')">🗑 حذف از مخاطبین</button>`;
  } else {
    const id = chatItem.getAttribute("data-chat");
    const chat = chatsMap[id];
    const meta = metaMap[id] || {};
    if (!chat || chat.type === "saved") return;

    if (!meta.archived) {
      html += meta.pinned
        ? `<button onclick="ctxUnpin('${id}')">📍 برداشتن سنجاق</button>`
        : `<button onclick="ctxPin('${id}')">📌 سنجاق کردن</button>`;
    }

    html += meta.archived
      ? `<button onclick="ctxUnarchive('${id}')">📤 خروج از بایگانی</button>`
      : `<button onclick="ctxArchive('${id}')">📥 بایگانی کردن</button>`;

    html += meta.mark_unread
      ? `<button onclick="ctxMarkRead('${id}')">✅ علامت‌گذاری به عنوان خوانده‌شده</button>`
      : `<button onclick="ctxMarkUnread('${id}')">🔵 علامت‌گذاری به عنوان خوانده‌نشده</button>`;

    html += `<button class="danger" onclick="ctxDelete('${id}')">🗑 حذف چت</button>`;
  }

  ctxMenu.innerHTML = html;
  ctxMenu.style.display = "block";

  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + "px";
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + "px";
});

document.addEventListener("click", () => { ctxMenu.style.display = "none"; });
document.addEventListener("scroll", () => { ctxMenu.style.display = "none"; }, true);

async function setMeta(chatId, fields) {
  const cur = metaMap[chatId] || {};
  await sb.from("chat_meta").upsert(
    { user_id: myId, chat_id: chatId, ...cur, ...fields },
    { onConflict: "user_id,chat_id" }
  );
}

window.ctxPin       = (id) => setMeta(id, { pinned: true });
window.ctxUnpin     = (id) => setMeta(id, { pinned: false });
window.ctxArchive   = (id) => setMeta(id, { archived: true });
window.ctxUnarchive = (id) => setMeta(id, { archived: false });
window.ctxMarkUnread = (id) => setMeta(id, { mark_unread: true });
window.ctxMarkRead  = (id) => setMeta(id, { mark_unread: false });

window.ctxDelete = async function (id) {
  const chat = chatsMap[id];
  if (!chat) return;
  const msg = chat.type === "private"
    ? "این چت برای تو حذف شود؟ (برای طرف مقابل باقی می‌ماند)"
    : "از این گروه/کانال خارج شوی؟";
  if (!confirm(msg)) return;

  const { error } = await sb.rpc("leave_chat", { p_chat: id });
  if (error) showErr("حذف نشد: " + error.message);
};

window.ctxRenameContact = async function (uid) {
  const c = contactsMap[uid];
  if (!c) return;
  const newName = prompt("اسم جدید برای این مخاطب:", c.name || "");
  if (newName === null) return;
  const name = newName.trim();
  if (!name) { alert("اسم نمی‌تواند خالی باشد"); return; }
  await sb.from("contacts").update({ name })
    .eq("owner", myId).eq("contact", uid);
};

window.ctxRemoveContact = async function (uid) {
  if (!confirm("این مخاطب از لیستت حذف شود؟ (چت‌هایتان پاک نمی‌شود)")) return;
  await sb.from("contacts").delete().eq("owner", myId).eq("contact", uid);
};

/* ---------- ناوبری ---------- */

window.openChat = function (id) { location.href = "chat.html?id=" + id; };
window.showArchivedView = function () { currentView = "archived"; render(); };
window.showMainView = function () { currentView = "main"; render(); };

window.showTab = function (tab) {
  document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById("tab-" + tab);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);
};

window.logout = function () { return doLogout(); };

window.openPrivateChat = async function (contactUid) {
  const { data } = await sb.from("chats").select("id")
    .eq("type", "private").contains("members", [myId, contactUid]).maybeSingle();

  let chatId = data && data.id;
  if (!chatId) {
    const ins = await sb.from("chats")
      .insert({ type: "private", members: [myId, contactUid], created_by: myId })
      .select("id").single();
    chatId = ins.data.id;
  }
  location.href = "chat.html?id=" + chatId;
};

/* ---------- افزودن مخاطب ---------- */

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
    let found = null;
    let query2 = sb.from("profiles").select("id,name,username,photo");

    if (q.startsWith("@")) {
      query2 = query2.eq("username", q.slice(1));
    } else if (/^(\+98|98|0)?9\d{9}$/.test(q.replace(/\s/g, ""))) {
      let p = q.replace(/\D/g, "");
      if (p.startsWith("98")) p = "0" + p.slice(2);
      if (p.length === 10) p = "0" + p;
      query2 = query2.eq("phone", p);
    } else if (q.includes("@")) {
      query2 = query2.eq("email", q);
    } else {
      resultDiv.innerHTML = "<p class='hint'>فرمت نامعتبر — با @آیدی، ایمیل یا شماره جستجو کن</p>";
      return;
    }

    const { data } = await query2.limit(1);
    if (data && data.length > 0) found = data[0];

    if (!found) {
      resultDiv.innerHTML = "<p class='hint'>پیدا نشد ❌</p>";
      return;
    }
    if (found.id === myId) {
      resultDiv.innerHTML = "<p class='hint'>این خودتی! 😄</p>";
      return;
    }

    resultDiv.innerHTML = `
      <div class="found-user">
        <div class="chat-item">
          <div class="avatar">${avatarHTML(found)}</div>
          <div>
            <div class="chat-name">${escapeHTML(found.name || "کاربر")}</div>
            <div class="chat-last">${found.username ? "@" + escapeHTML(found.username) : ""}</div>
          </div>
        </div>
        <label class="modal-label">اسم مخاطب (دلخواه — می‌توانی عوضش کنی):</label>
        <input id="add-name" type="text"
            onkeydown="if(event.key === 'Enter') document.getElementById('add-btn').click()">
        <button id="add-btn">افزودن به مخاطبین ➕</button>
      </div>`;

    document.getElementById("add-name").value = found.name || "کاربر";

    document.getElementById("add-btn").onclick = async () => {
      const customName =
        document.getElementById("add-name").value.trim() || found.name || "کاربر";

      const { error } = await sb.from("contacts").upsert({
        owner: myId, contact: found.id,
        name: customName, username: found.username || "", photo: found.photo || ""
      }, { onConflict: "owner,contact" });

      if (error) { showErr("افزودن نشد: " + error.message); return; }
      resultDiv.innerHTML = "<p class='hint ok-text'>اضافه شد ✅</p>";
      setTimeout(closeAddContact, 800);
    };
  } catch (e) {
    showErr("خطای جستجو: " + e.message);
  }
};

/* ---------- پروفایل ---------- */

window.saveProfile = async function () {
  const name = document.getElementById("set-name").value.trim() || "کاربر";
  const bio = document.getElementById("set-bio").value.trim();
  const username = document.getElementById("set-username").value.trim().toLowerCase();

  if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
    alert("آیدی نامعتبر: ۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _");
    return;
  }

  if (username !== (myData.username || "")) {
    if (username) {
      const { data: existing } = await sb.from("profiles")
        .select("id").eq("username", username).maybeSingle();
      if (existing) { alert("این آیدی قبلاً گرفته شده ❌"); return; }
    }
  }

  const { error } = await sb.from("profiles")
    .update({ name, bio, username: username || "" })
    .eq("id", myId);

  if (error) {
    if (error.code === "23505") alert("این آیدی قبلاً گرفته شده ❌");
    else alert("ذخیره نشد: " + error.message);
    return;
  }

  myData.name = name; myData.bio = bio; myData.username = username;

  document.getElementById("user-name").textContent = name;
  renderAvatar(document.getElementById("my-avatar"), myData);
  alert("ذخیره شد ✅");
};

window.uploadPhoto = function (input) {
  const file = input.files[0];
  if (!file || !myId) return;

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

        const { error } = await sb.from("profiles")
          .update({ photo: dataUrl }).eq("id", myId);
        if (error) throw error;

        myData.photo = dataUrl;
        renderAvatar(document.getElementById("set-avatar"), myData);
        renderAvatar(document.getElementById("my-avatar"), myData);
        alert("عکس ذخیره شد ✅");
      } catch (err) {
        showErr("خطای ذخیره عکس: " + err.message);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

/* ---------- اعلان و حالت شب ---------- */

window.askNotifPerm = async function () {
  if (!("Notification" in window)) {
    alert("مرورگرت از اعلان پشتیبانی نمی‌کند");
    return;
  }
  const p = await Notification.requestPermission();
  alert(p === "granted" ? "اعلان‌ها فعال شد ✅" : "اعلان‌ها رد شد ❌");
};

window.toggleDark = function (on) {
  document.body.classList.toggle("dark", on);
  localStorage.setItem("dark", on ? "1" : "0");
};

start();

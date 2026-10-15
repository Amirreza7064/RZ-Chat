import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  doc, getDoc, updateDoc, setDoc, arrayUnion
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

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAvatar(el, data) {
  if (data && data.photo) {
    el.innerHTML = `<img src="${data.photo}" alt="">`;
  } else {
    el.textContent = ((data && data.name) || "؟").charAt(0);
  }
}

function markAsRead() {
  if (!currentUser || !chatId) return;
  setDoc(doc(db, "users", currentUser.uid, "chatMeta", chatId), {
    lastReadTime: Date.now(),
    markUnread: false
  }, { merge: true }).catch(() => {});
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  currentUser = user;

  if (!chatId) {
    location.href = "chats.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  myName = userSnap.exists() ? (userSnap.data().name || "کاربر") : "کاربر";

  const chatSnap = await getDoc(doc(db, "chats", chatId));
  if (!chatSnap.exists()) {
    alert("این چت وجود ندارد");
    location.href = "chats.html";
    return;
  }
  chatData = chatSnap.data();

  const members = chatData.members || [];

  /* ---------- پیام‌های ذخیره‌شده ---------- */
  if (chatData.type === "saved") {
    isSaved = true;
    document.getElementById("chat-icon").textContent = "🔖";
    document.getElementById("chat-title").textContent = "پیام‌های ذخیره‌شده";
    document.getElementById("chat-sub").textContent = "فقط برای خودت";
    document.getElementById("send-box").style.display = "flex";
    markAsRead();
    listenMessages();
    return;
  }

  /* ---------- چت خصوصی ---------- */
  if (chatData.type === "private") {
    isPrivate = true;
    if (!members.includes(currentUser.uid)) {
      alert("این چت مال تو نیست ❌");
      location.href = "chats.html";
      return;
    }
    const otherUid = members.find(u => u !== currentUser.uid);
    const otherSnap = otherUid ? await getDoc(doc(db, "users", otherUid)) : null;
    const other = otherSnap && otherSnap.exists() ? otherSnap.data() : { name: "کاربر" };

    renderAvatar(document.getElementById("chat-icon"), other);
    document.getElementById("chat-title").textContent = other.name || "کاربر";
    document.getElementById("chat-sub").textContent =
      other.username ? "@" + other.username : "چت خصوصی";
    document.getElementById("send-box").style.display = "flex";
    markAsRead();
    listenMessages();
    return;
  }

  /* ---------- گروه یا کانال ---------- */
  const isMember = members.includes(currentUser.uid);
  const isAdmin = (chatData.admins || []).includes(currentUser.uid);

  document.getElementById("chat-title").textContent = chatData.name;
  document.getElementById("chat-icon").textContent =
    chatData.type === "channel" ? "📢" : "👥";
  document.getElementById("chat-sub").textContent =
    chatData.type === "channel" ? "کانال" : "گروه";

  if (!isMember) {
    /* ----- غیرعضو: نمایش نوار عضویت (پیش‌نمایش پیام‌ها مثل تلگرام) ----- */
    const bar = document.getElementById("join-bar");
    document.getElementById("join-text").textContent =
      chatData.type === "channel"
        ? "برای دنبال کردن این کانال عضو شو:"
        : "برای ارسال پیام در این گروه عضو شو:";
    bar.style.display = "flex";
  } else {
    /* ----- عضو ----- */
    if (chatData.type !== "channel" || isAdmin) {
      document.getElementById("send-box").style.display = "flex";
    }
    // دکمه دعوت برای همه اعضا
    document.getElementById("invite-btn").style.display = "inline-block";
  }

  markAsRead();
  listenMessages();
});

/* ---------- عضویت از طریق لینک ---------- */

window.joinChat = async function () {
  if (!currentUser || !chatData) return;
  try {
    await updateDoc(doc(db, "chats", chatId), {
      members: arrayUnion(currentUser.uid)
    });
    location.reload(); // بعد از عضویت، صفحه به حالت عادی باز می‌شود
  } catch (e) {
    console.error(e);
    alert("عضویت ناموفق بود");
  }
};

/* ---------- مودال دعوت ---------- */

window.openInvite = function () {
  const input = document.getElementById("invite-link");
  input.value =
    location.origin + location.pathname + "?id=" + chatId;
  document.getElementById("invite-modal").classList.add("show");
};

window.closeInvite = function () {
  document.getElementById("invite-modal").classList.remove("show");
};

window.copyInvite = function () {
  const input = document.getElementById("invite-link");
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => alert("کپی شد ✅"))
    .catch(() => document.execCommand("copy"));
};

/* ---------- ارسال پیام ---------- */

async function sendMessage() {
  if (!chatData || !currentUser) return;

  if (!isPrivate && !isSaved && chatData.type === "channel") {
    const isAdmin = (chatData.admins || []).includes(currentUser.uid);
    if (!isAdmin) return;
  }

  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    text: text,
    senderName: myName,
    uid: currentUser.uid,
    time: Date.now()
  });

  updateDoc(doc(db, "chats", chatId), {
    lastMessage: text,
    lastMessageTime: Date.now()
  });

  input.value = "";
  input.focus();
}

window.sendMessage = sendMessage;

function listenMessages() {
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("time"));

  onSnapshot(q, (snapshot) => {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isMine = data.uid === currentUser.uid;
      const time = new Date(data.time).toLocaleTimeString("fa-IR", {
        hour: "2-digit", minute: "2-digit"
      });

      const senderHtml = (!isMine && !isPrivate && !isSaved)
        ? `<div class="sender">${escapeHTML(data.senderName || "ناشناس")}</div>`
        : "";

      messagesDiv.innerHTML += `
        <div class="message ${isMine ? "mine" : ""}">
          ${senderHtml}
          <div class="text">${escapeHTML(data.text)}</div>
          <div class="time">${time}</div>
        </div>`;
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    markAsRead();
  });
}

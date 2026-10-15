import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, orderBy, onSnapshot,
  doc, getDoc, updateDoc
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

  document.getElementById("chat-title").textContent = chatData.name;
  document.getElementById("chat-icon").textContent =
    chatData.type === "channel" ? "📢" : "👥";
  document.getElementById("chat-sub").textContent =
    chatData.type === "channel" ? "کانال" : "گروه";

  const isAdmin = (chatData.admins || []).includes(currentUser.uid);
  if (chatData.type !== "channel" || isAdmin) {
    document.getElementById("send-box").style.display = "flex";
  }

  listenMessages();
});

async function sendMessage() {
  if (!chatData || !currentUser) return;

  const isAdmin = (chatData.admins || []).includes(currentUser.uid);
  if (chatData.type === "channel" && !isAdmin) return;

  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    text: text,
    senderName: myName,
    uid: currentUser.uid,
    time: Date.now()
  });

  updateDoc(doc(db, "chats", chatId), { lastMessage: text });

  input.value = "";
  input.focus();
}

window.sendMessage = sendMessage;

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

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

      messagesDiv.innerHTML += `
        <div class="message ${isMine ? "mine" : ""}">
          ${isMine ? "" : `<div class="sender">${escapeHTML(data.senderName || "ناشناس")}</div>`}
          <div class="text">${escapeHTML(data.text)}</div>
          <div class="time">${time}</div>
        </div>`;
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

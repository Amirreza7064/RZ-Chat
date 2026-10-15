import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, onSnapshot, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  const name = userSnap.exists() ? userSnap.data().name : (user.email || "کاربر");
  document.getElementById("user-name").textContent = name;
  document.getElementById("avatar").textContent = name.charAt(0);

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", user.uid)
  );

  onSnapshot(q, (snapshot) => {
    const list = document.getElementById("chat-list");
    list.innerHTML = "";

    if (snapshot.empty) {
      list.innerHTML = "<p class='empty'>هنوز گروه یا کانالی نداری! 🙁</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const chat = docSnap.data();
      const icon = chat.type === "channel" ? "📢" : "👥";
      list.innerHTML += `
        <div class="chat-item" onclick="location.href='chat.html?id=${docSnap.id}'">
          <div class="avatar">${icon}</div>
          <div>
            <div class="chat-name">${escapeHTML(chat.name)}</div>
            <div class="chat-last">${escapeHTML(chat.lastMessage || "..." )}</div>
          </div>
        </div>`;
    });
  });
});

window.logout = async function () {
  await signOut(auth);
  location.href = "index.html";
};

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

const type = new URLSearchParams(location.search).get("type") === "channel"
  ? "channel" : "group";

document.getElementById("page-title").textContent =
  type === "channel" ? "ساخت کانال" : "ساخت گروه";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  currentUser = user;
});

window.createChat = async function () {
  if (!currentUser) {
    alert("لطفاً صبر کن... در حال بارگذاری");
    return;
  }

  const name = document.getElementById("chat-name").value.trim();
  const description = document.getElementById("chat-desc").value.trim();

  if (!name) {
    alert("نام را وارد کن");
    return;
  }

  const ref = await addDoc(collection(db, "chats"), {
    type: type,
    name: name,
    description: description,
    createdBy: currentUser.uid,
    members: [currentUser.uid],
    admins: [currentUser.uid],
    lastMessage: "",
    createdAt: Date.now()
  });

  location.href = "chat.html?id=" + ref.id;
};

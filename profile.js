import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentData = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  currentUser = user;
  const snap = await getDoc(doc(db, "users", user.uid));
  currentData = snap.exists() ? snap.data() : {};

  document.getElementById("name").value = currentData.name || "";
  document.getElementById("username").value = currentData.username || "";
  document.getElementById("bio").value = currentData.bio || "";
  document.getElementById("avatar").textContent = (currentData.name || "؟").charAt(0);
});

window.checkUsername = async function () {
  const status = document.getElementById("username-status");
  const username = document.getElementById("username").value.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    status.textContent = "❌ ۳ تا ۲۰ کاراکتر انگلیسی، عدد یا _";
    status.className = "error";
    return false;
  }

  if (username === (currentData.username || "")) return true;

  const existing = await getDoc(doc(db, "usernames", username));
  if (existing.exists()) {
    status.textContent = "❌ این آیدی قبلاً گرفته شده";
    status.className = "error";
    return false;
  }

  status.textContent = "✅ این آیدی آزاد است";
  status.className = "ok";
  return true;
};

window.saveProfile = async function () {
  const name = document.getElementById("name").value.trim() || "کاربر";
  const bio = document.getElementById("bio").value.trim();
  const username = document.getElementById("username").value.trim().toLowerCase();

  if (!(await window.checkUsername())) return;

  if (username !== (currentData.username || "")) {
    if (currentData.username) {
      await deleteDoc(doc(db, "usernames", currentData.username));
    }
    await setDoc(doc(db, "usernames", username), { uid: currentUser.uid });
  }

  await updateDoc(doc(db, "users", currentUser.uid), { name, bio, username });
  alert("ذخیره شد ✅");
  location.href = "chats.html";
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, limit, getDocs,
  onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;
let myData = {};
const userCache = {};

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

/* ---------- نمایش خطا روی صفحه (برای پیدا کردن مشکل) ---------- */

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

async function getUserInfo(uid) {
  if (userCache[uid]) return userCache[uid];
  const s = await getDoc(doc(db, "users", uid));
  const d = s.exists() ? s.data() : { name: "کاربر" };
  userCache[uid] = d;
  return d;
}

/* ---------- شروع ---------- */

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      location.href = "index.html";
      return;
    }
    me = user;

    // چک می‌کنیم HTML جدید جایگزین شده باشد
    const required = ["my-avatar", "user-name", "chat-list", "contact-list",
                      "set-name", "set-username", "set-bio", "set-avatar",
                      "info-email", "info-phone", "dark-toggle"];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
      showErr("فایل chats.html قدیمی است! نسخه جدید را در ریپو بگذار. (عنصر گم‌شده: " + missing.join(", ") + ")");
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

    listenChats();
    listenContacts();

  } catch (e) {
    showErr("خطای بارگذاری: " + (e.code || e.message));
  }
});

/* ---------- تب‌ها و خروج ---------- */

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

/* ---------- لیست چت‌ها ---------- */

function listenChats() {
  const list = document.getElementById("chat-list");
  list.innerHTML = "<p class='empty'>⏳ در حال بارگذاری چت‌ها...</p>";

  const q = query(collection(db, "chats"), where("members", "array-contains", me.uid));

  onSnapshot(q, async (snapshot) => {
    if (snapshot.empty) {
      list.innerHTML = "<p class='empty'>چتی نداری! دکمه ＋ پایین را بزن 👇</p>";
      return;
    }

    let html = "";
    try {
      for (const docSnap of snapshot.docs) {
        const chat = docSnap.data();
        let iconHtml, title;

        if (chat.type === "private") {
          const otherUid = (chat.members || []).find(u => u !== me.uid);
          const info = otherUid ? await getUserInfo(otherUid) : { name: "کاربر" };
          const tmp = document.createElement("div");
          renderAvatar(tmp, info);
          iconHtml = tmp.innerHTML;
          title = info.name || "کاربر";
        } else {
          iconHtml = chat.type === "channel" ? "📢" : "👥";
          title = chat.name;
        }

        html += `
          <div class="chat-item" onclick="location.href='chat.html?id=${docSnap.id}'">
            <div class="avatar">${iconHtml}</div>
            <div>
              <div class="chat-name">${escapeHTML(title)}</div>
              <div class="chat-last">${escapeHTML(chat.lastMessage || "...")}</div>
            </div>
          </div>`;
      }
      list.innerHTML = html;
    } catch (e) {
      showErr("خطای ساخت لیست چت‌ها: " + (e.code || e.message));
    }

  }, (error) => {
    showErr("خطای دیتابیس (چت‌ها): " + error.code);
    list.innerHTML = "";
  });
}

/* ---------- مخاطبین ---------- */

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
      const tmp = document.createElement("div");
      renderAvatar(tmp, c);
      html += `
        <div class="chat-item" onclick="openPrivateChat('${docSnap.id}')">
          <div class="avatar">${tmp.innerHTML}</div>
          <div>
            <div class="chat-name">${escapeHTML(c.name)}</div>
            <div class="chat-last">${c.username ? "@" + escapeHTML(c.username) : "چت خصوصی"}</div>
          </div>
        </div>`;
    });
    list.innerHTML = html;

  }, (error) => {
    showErr("خطای دیتابیس (مخاطبین): " + error.code);
    list.innerHTML = "";
  });
}

// کلیک روی مخاطب → باز کردن (یا ساختن) چت خصوصی
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
    const tmp = document.createElement("div");
    renderAvatar(tmp, data);

    resultDiv.innerHTML = `
      <div class="found-user">
        <div class="chat-item">
          <div class="avatar">${tmp.innerHTML}</div>
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
      resultDiv.innerHTML = "<p class='hint ok-text'>اضافه شد ✅</p>";
      setTimeout(closeAddContact, 800);
    };
  } catch (e) {
    showErr("خطای جستجو: " + (e.code || e.message));
  }
};

/* ---------- ذخیره پروفایل ---------- */

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
      const existing = await getDoc(doc(db, "usernames", username));
      if (existing.exists()) {
        alert("این آیدی قبلاً گرفته شده ❌");
        return;
      }
      await setDoc(doc(db, "usernames", username), { uid: me.uid });
    }
    if (myData.username) {
      await deleteDoc(doc(db, "usernames", myData.username));
    }
  }

  await updateDoc(doc(db, "users", me.uid), { name, bio, username: username || "" });
  myData = { ...myData, name, bio, username };

  document.getElementById("user-name").textContent = name;
  renderAvatar(document.getElementById("my-avatar"), myData);
  alert("ذخیره شد ✅");
};

/* ---------- آپلود عکس پروفایل ---------- */

window.uploadPhoto = function (input) {
  const file = input.files[0];
  if (!file || !me) return;

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
        ctx.drawImage(
          img,
          (img.width - min) / 2, (img.height - min) / 2, min, min,
          0, 0, size, size
        );
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

        await updateDoc(doc(db, "users", me.uid), { photo: dataUrl });
        myData.photo = dataUrl;
        renderAvatar(document.getElementById("set-avatar"), myData);
        renderAvatar(document.getElementById("my-avatar"), myData);
        alert("عکس ذخیره شد ✅");
      } catch (err) {
        showErr("خطای ذخیره عکس: " + (err.code || err.message));
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

/* ---------- حالت شب ---------- */

window.toggleDark = function (on) {
  document.body.classList.toggle("dark", on);
  localStorage.setItem("dark", on ? "1" : "0");
};

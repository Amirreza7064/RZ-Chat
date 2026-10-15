import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

const type = new URLSearchParams(location.search).get("type") === "channel"
  ? "channel" : "group";

document.getElementById("page-title").textContent =
  type === "channel" ? "ساخت کانال" : "ساخت گروه";

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function avatarHTML(data) {
  if (data && data.photo) {
    return `<img src="${data.photo}" alt="">`;
  }
  return ((data && data.name) || "؟").charAt(0);
}

/* ----- بارگذاری مخاطبین برای انتخاب عضو ----- */

async function loadContacts() {
  const picker = document.getElementById("member-picker");

  try {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "contacts"));

    if (snap.empty) {
      picker.innerHTML = "<p class='hint'>مخاطبی نداری — بعداً می‌توانی با لینک دعوت عضو اضافه کنی.</p>";
      return;
    }

    let html = "";
    snap.forEach((d) => {
      const c = d.data();
      html += `
        <label class="member-row">
          <input type="checkbox" value="${d.id}">
          <div class="avatar">${avatarHTML(c)}</div>
          <div>
            <div class="chat-name">${escapeHTML(c.name)}</div>
            <div class="chat-last">${c.username ? "@" + escapeHTML(c.username) : ""}</div>
          </div>
        </label>`;
    });
    picker.innerHTML = html;
  } catch (e) {
    picker.innerHTML = "<p class='hint'>خطا در بارگذاری مخاطبین</p>";
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  currentUser = user;
  loadContacts();
});

/* ----- ساخت چت ----- */

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

  // اعضای تیک‌خورده از مخاطبین
  const selected = [];
  document.querySelectorAll("#member-picker input[type=checkbox]:checked")
    .forEach(cb => selected.push(cb.value));

  const ref = await addDoc(collection(db, "chats"), {
    type: type,
    name: name,
    description: description,
    createdBy: currentUser.uid,
    members: [currentUser.uid, ...selected],
    admins: [currentUser.uid],
    lastMessage: "",
    lastMessageTime: Date.now(),
    createdAt: Date.now()
  });

  // نمایش لینک دعوت
  const inviteURL =
    location.origin + location.pathname.replace("create.html", "chat.html")
    + "?id=" + ref.id;

  document.getElementById("create-form").style.display = "none";
  document.getElementById("created-box").style.display = "block";
  document.getElementById("new-invite-link").value = inviteURL;
  document.getElementById("goto-chat-btn").onclick = () => {
    location.href = "chat.html?id=" + ref.id;
  };
};

window.copyNewInvite = function () {
  const input = document.getElementById("new-invite-link");
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => alert("کپی شد ✅"))
    .catch(() => document.execCommand("copy"));
};

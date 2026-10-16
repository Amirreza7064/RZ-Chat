import { sb } from './supabase.js';

let obData = { photo: null };

if (localStorage.getItem("dark") === "1") document.body.classList.add("dark");

async function ensureSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = "index.html"; return null; }
  return session.user;
}

window.obPhoto = function (input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const size = 200;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
      obData.photo = canvas.toDataURL("image/jpeg", 0.8);
      document.getElementById("ob-avatar").innerHTML = `<img src="${obData.photo}">`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.obStep2 = function () {
  document.querySelector(".page-box").innerHTML = `
    <h2>۲ از ۳ — نام و آیدی ✏️</h2>
    <label>نام نمایشی:</label>
    <input id="ob-name" type="text" placeholder="مثلاً امیررضا">
    <label>آیدی (انگلیسی/عدد/_):</label>
    <div class="username-field">
        <span>@</span>
        <input id="ob-username" type="text" placeholder="username">
    </div>
    <p id="ob-err" class="hint"></p>
    <button onclick="obCheckNext()">بعدی ←</button>`;
  document.getElementById("ob-name").focus();
};

window.obCheckNext = async function () {
  const name = document.getElementById("ob-name").value.trim();
  const username = document.getElementById("ob-username").value.trim().toLowerCase();
  const err = document.getElementById("ob-err");

  if (name.length < 2) { err.textContent = "اسم حداقل ۲ حرف"; return; }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    err.textContent = "آیدی: ۳ تا ۲۰ کاراکتر انگلیسی/عدد/_";
    return;
  }

  const { data: taken } = await sb.from("profiles")
    .select("id").eq("username", username).maybeSingle();
  if (taken) { err.textContent = "❌ این آیدی قبلاً گرفته شده"; return; }

  obData.name = name;
  obData.username = username;
  obStep3();
};

function obStep3() {
  document.querySelector(".page-box").innerHTML = `
    <h2>۳ از ۳ — بیوگرافی 📝</h2>
    <label>یه جمله درباره خودت (اختیاری):</label>
    <input id="ob-bio" type="text" placeholder="درباره من..."
        onkeydown="if(event.key === 'Enter') obFinish()">
    <button onclick="obFinish()">شروع چت! 🚀</button>`;
  document.getElementById("ob-bio").focus();
}

window.obFinish = async function () {
  const user = await ensureSession();
  if (!user) return;

  const bio = document.getElementById("ob-bio").value.trim();

  const { error } = await sb.from("profiles").update({
    name: obData.name,
    username: obData.username,
    bio: bio,
    photo: obData.photo,
    profile_done: true
  }).eq("id", user.id);

  if (error) { alert("خطا در ذخیره: " + error.message); return; }
  location.href = "chats.html";
};

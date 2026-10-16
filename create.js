import { sb, initAuth, escapeHTML, avatarHTML, getMyId } from './auth.js';

let myId = null;

const type = new URLSearchParams(location.search).get("type") === "channel"
  ? "channel" : "group";

document.getElementById("page-title").textContent =
  type === "channel" ? "ساخت کانال" : "ساخت گروه";

async function loadContacts() {
  const picker = document.getElementById("member-picker");

  const { data, error } = await sb.from("contacts")
    .select("*").eq("owner", myId);

  if (error || !data || data.length === 0) {
    picker.innerHTML = "<p class='hint'>مخاطبی نداری — بعداً می‌توانی با لینک دعوت عضو اضافه کنی.</p>";
    return;
  }

  let html = "";
  data.forEach((c) => {
    html += `
      <label class="member-row">
        <input type="checkbox" value="${c.contact}">
        <div class="avatar">${avatarHTML(c)}</div>
        <div>
          <div class="chat-name">${escapeHTML(c.name)}</div>
          <div class="chat-last">${c.username ? "@" + escapeHTML(c.username) : ""}</div>
        </div>
      </label>`;
  });
  picker.innerHTML = html;
}

async function start() {
  if (!await initAuth()) return;
  myId = getMyId();
  loadContacts();
}

window.createChat = async function () {
  if (!myId) { alert("در حال بارگذاری..."); return; }

  const name = document.getElementById("chat-name").value.trim();
  const description = document.getElementById("chat-desc").value.trim();

  if (!name) { alert("نام را وارد کن"); return; }

  const selected = [];
  document.querySelectorAll("#member-picker input[type=checkbox]:checked")
    .forEach(cb => selected.push(cb.value));

  const { data, error } = await sb.from("chats").insert({
    type: type,
    name: name,
    description: description,
    created_by: myId,
    members: [myId, ...selected],
    admins: [myId],
    last_message: "",
    last_message_time: Date.now()
  }).select("id").single();

  if (error) { alert("ساخت نشد: " + error.message); return; }

  const inviteURL =
    location.origin + location.pathname.replace("create.html", "chat.html")
    + "?id=" + data.id;

  document.getElementById("create-form").style.display = "none";
  document.getElementById("created-box").style.display = "block";
  document.getElementById("new-invite-link").value = inviteURL;
  document.getElementById("goto-chat-btn").onclick = () => {
    location.href = "chat.html?id=" + data.id;
  };
};

window.copyNewInvite = function () {
  const input = document.getElementById("new-invite-link");
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => alert("کپی شد ✅"))
    .catch(() => document.execCommand("copy"));
};

start();

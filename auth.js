import { sb } from './supabase.js';

let _me = null;
let _myId = null;

async function initAuth(requireProfile = true) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.href = "index.html";
    return false;
  }
  _myId = session.user.id;

  const { data } = await sb.from("profiles").select("*").eq("id", _myId).single();
  _me = data || { id: _myId, email: session.user.email, name: "کاربر", profile_done: false };

  if (requireProfile && _me.profile_done === false) {
    location.href = "onboard.html";
    return false;
  }
  return true;
}

async function loadProfileFresh() {
  const { data } = await sb.from("profiles").select("*").eq("id", _myId).single();
  if (data) _me = data;
  return _me;
}

async function doLogout() {
  await sb.auth.signOut();
  location.href = "index.html";
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function renderAvatar(el, data) {
  if (!el) return;
  if (data && data.photo) {
    el.innerHTML = `<img src="${data.photo}" alt="">`;
  } else {
    el.textContent = ((data && data.name) || "؟").charAt(0);
  }
}

function avatarHTML(data) {
  const t = document.createElement("div");
  renderAvatar(t, data);
  return t.innerHTML;
}

async function getUserInfo(uid) {
  const { data } = await sb.from("profiles")
    .select("id,email,phone,name,username,bio,photo")
    .eq("id", uid).maybeSingle();
  return data || { id: uid, name: "کاربر" };
}

export { sb, initAuth, loadProfileFresh, doLogout, escapeHTML, renderAvatar, avatarHTML, getUserInfo };
export function getMe() { return _me; }
export function getMyId() { return _myId; }

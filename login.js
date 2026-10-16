import { sb } from './supabase.js';

// ✅ آدرس سایت تو
const SITE_URL = "https://rz-chat.rz-ai.workers.dev/index.html";

function maskEmail(e) {
  const p = e.split("@");
  return p[0].charAt(0) + "***@" + p[1];
}

function normalizePhone(input) {
  let p = String(input || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+98")) p = "0" + p.slice(3);
  else if (p.startsWith("98") && p.length === 12) p = "0" + p.slice(2);
  else if (p.length === 10 && p.startsWith("9")) p = "0" + p;
  return p;
}

/* ---------- لاگین‌شده؟ مستقیم برو صفحه اصلی ---------- */

window.addEventListener("load", async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const { data: prof } = await sb.from("profiles")
    .select("profile_done").eq("id", session.user.id).single();

  location.href = (prof && prof.profile_done) ? "chats.html" : "onboard.html";
});

/* ---------- ایمیل و رمز ---------- */

window.registerUser = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) { alert("ایمیل و رمز را وارد کن"); return; }

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { alert(error.message); return; }

  if (data.session) {
    location.href = "onboard.html";
  } else {
    alert("ثبت‌نام انجام شد! به ایمیلت برو و تأیید کن، بعد وارد شو.");
  }
};

window.loginUser = async function () {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) { alert("ایمیل و رمز را وارد کن"); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { alert(error.message); return; }

  const { data: prof } = await sb.from("profiles")
    .select("profile_done").eq("id", data.user.id).single();

  location.href = (prof && prof.profile_done) ? "chats.html" : "onboard.html";
};

/* ---------- ورود با شماره (لینک ایمیلی) ---------- */

window.phoneLogin = async function () {
  const status = document.getElementById("phone-status");
  const phone = normalizePhone(document.getElementById("phone").value);
  const emailInput = document.getElementById("phone-email").value.trim().toLowerCase();

  if (!/^09\d{9}$/.test(phone)) {
    alert("شماره موبایل نامعتبر است. مثال: 09123456789");
    return;
  }

  status.textContent = "در حال بررسی شماره...";

  const { data: existingEmail } = await sb.rpc("get_phone_email", { p_phone: phone });

  let email;
  if (existingEmail) {
    if (emailInput && emailInput !== existingEmail) {
      status.textContent = "❌ این شماره با ایمیل دیگری ثبت شده: " + maskEmail(existingEmail);
      return;
    }
    email = existingEmail;
  } else {
    if (!emailInput) {
      status.textContent = "این شماره ثبت نشده؛ برای ثبت‌نام ایمیلت را هم وارد کن.";
      return;
    }
    email = emailInput;
  }

  const { error } = await sb.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: SITE_URL + "?phone=" + encodeURIComponent(phone) }
  });

  if (error) {
    console.error(error);
    status.textContent = "خطا! " + error.message;
    return;
  }

  localStorage.setItem("phoneForSignIn", phone);
  status.textContent = "✉️ لینک ورود به " + maskEmail(email) + " فرستاده شد — ایمیلت را چک کن!";
};

/* ---------- تکمیل خودکار ورود بعد از کلیک لینک ایمیل ---------- */

async function handleEmailLink() {
  if (!window.location.hash.includes("access_token")) return;

  let tries = 0;
  let session = null;
  while (tries < 20 && !session) {
    const r = await sb.auth.getSession();
    session = r.data.session;
    if (!session) await new Promise(r2 => setTimeout(r2, 300));
    tries++;
  }
  if (!session) return;

  const urlPhone = new URLSearchParams(location.search).get("phone");
  const phone = normalizePhone(urlPhone || localStorage.getItem("phoneForSignIn") || "");

  if (phone) {
    await sb.rpc("claim_phone", { p_phone: phone });
    localStorage.removeItem("phoneForSignIn");
  }

  const { data: prof } = await sb.from("profiles")
    .select("profile_done").eq("id", session.user.id).single();

  location.href = (prof && prof.profile_done) ? "chats.html" : "onboard.html";
}

window.addEventListener("hashchange", handleEmailLink);
window.addEventListener("load", handleEmailLink);

/* ---------- تب‌ها ---------- */

window.showTab = function (tab) {
  document.getElementById("email-tab").style.display = tab === "email" ? "block" : "none";
  document.getElementById("phone-tab").style.display = tab === "phone" ? "block" : "none";

  const tabs = document.querySelectorAll(".tab");
  tabs[0].classList.toggle("active", tab === "email");
  tabs[1].classList.toggle("active", tab === "phone");
};

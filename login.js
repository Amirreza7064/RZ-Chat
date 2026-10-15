import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ✏️✏️✏️ این خط را با آدرس واقعی index.html روی سایت خودت عوض کن ✏️✏️✏️
const SITE_URL = "https://Amirreza7064.github.io/RZ-Chat/index.html";

function actionCodeSettings(phone) {
  return {
    url: SITE_URL + "?phone=" + encodeURIComponent(phone),
    handleCodeInApp: true
  };
}

function normalizePhone(input) {
  let p = String(input || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+98")) p = "0" + p.slice(3);
  else if (p.startsWith("98") && p.length === 12) p = "0" + p.slice(2);
  else if (p.length === 10 && p.startsWith("9")) p = "0" + p;
  return p;
}

function maskEmail(email) {
  const parts = email.split("@");
  return parts[0].charAt(0) + "***@" + parts[1];
}

async function createUserProfile(user, phone = "") {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      phone: phone,
      name: "کاربر جدید",
      username: "",
      bio: "",
      createdAt: Date.now()
    });
  }
}

/* ---------- تب ایمیل و رمز ---------- */

window.registerUser = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await createUserProfile(cred.user);
    location.href = "chats.html";
  } catch (error) {
    alert(error.message);
  }
};

window.loginUser = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    location.href = "chats.html";
  } catch (error) {
    alert(error.message);
  }
};

/* ---------- تب شماره تلفن (لینک ایمیل جای پیامک) ---------- */

window.phoneLogin = async function () {
  const status = document.getElementById("phone-status");
  const phone = normalizePhone(document.getElementById("phone").value);
  const emailInput = document.getElementById("phone-email").value.trim().toLowerCase();

  if (!/^09\d{9}$/.test(phone)) {
    alert("شماره موبایل نامعتبر است. مثال: 09123456789");
    return;
  }

  status.textContent = "در حال بررسی شماره...";

  try {
    const snap = await getDoc(doc(db, "phones", phone));

    if (snap.exists()) {
      /* ----- شماره قبلاً ثبت شده → ورود ----- */
      const email = snap.data().email;

      if (emailInput && emailInput !== email) {
        status.textContent = "❌ این شماره با ایمیل دیگری ثبت شده: " + maskEmail(email);
        return;
      }

      await sendSignInLinkToEmail(auth, email, actionCodeSettings(phone));
      localStorage.setItem("emailForSignIn", email);
      localStorage.setItem("phoneForSignIn", phone);
      status.textContent = "✉️ لینک ورود به " + maskEmail(email) + " فرستاده شد — ایمیلت را چک کن!";

    } else {
      /* ----- شماره جدید → ثبت‌نام ----- */
      if (!emailInput) {
        status.textContent = "این شماره ثبت نشده؛ برای ثبت‌نام ایمیلت را هم وارد کن.";
        return;
      }

      await sendSignInLinkToEmail(auth, emailInput, actionCodeSettings(phone));
      localStorage.setItem("emailForSignIn", emailInput);
      localStorage.setItem("phoneForSignIn", phone);
      status.textContent = "✉️ لینک ثبت‌نام به " + maskEmail(emailInput) + " فرستاده شد — روی لینک کلیک کن!";
    }
  } catch (e) {
    console.error(e);
    status.textContent = "خطا! دوباره امتحان کن.";
  }
};

/* ---------- تکمیل خودکار ورود بعد از کلیک روی لینک ایمیل ---------- */

window.addEventListener("load", async () => {
  if (!isSignInWithEmailLink(auth, location.href)) return;

  // ایمیل: اول از حافظه، اگر نبود (لینک روی دستگاه دیگر باز شده) بپرس
  let email = localStorage.getItem("emailForSignIn") || prompt("برای تکمیل ورود، ایمیلت را وارد کن:");
  if (!email) return;
  email = email.trim().toLowerCase();

  // شماره: اول از لینک (?phone=...)، بعد از حافظه
  const urlPhone = new URLSearchParams(location.search).get("phone");
  const phone = normalizePhone(urlPhone || localStorage.getItem("phoneForSignIn") || "");

  try {
    const cred = await signInWithEmailLink(auth, email, location.href);
    // لینک اینجا مصرف شد → یک‌بار مصرف بود و تمام ✅

    localStorage.removeItem("emailForSignIn");
    localStorage.removeItem("phoneForSignIn");

    if (phone) {
      const phoneRef = doc(db, "phones", phone);
      const snap = await getDoc(phoneRef);

      if (!snap.exists()) {
        // ثبت‌نام: اتصال شماره به این حساب
        await setDoc(phoneRef, { uid: cred.user.uid, email: email });
        await createUserProfile(cred.user, phone);
      } else if (snap.data().uid === cred.user.uid) {
        // ورود: شماره از قبل مال خودش است
        await createUserProfile(cred.user, phone);
      } else {
        // شماره مال کاربر دیگری است
        await signOut(auth);
        alert("این شماره به حساب دیگری متصل است ❌");
        return;
      }
    }

    location.href = "chats.html";
  } catch (e) {
    console.error(e);
    alert("لینک نامعتبر است یا منقضی شده. دوباره امتحان کن.");
  }
});

/* ---------- تب‌ها ---------- */

window.showTab = function (tab) {
  document.getElementById("email-tab").style.display = tab === "email" ? "block" : "none";
  document.getElementById("phone-tab").style.display = tab === "phone" ? "block" : "none";

  const tabs = document.querySelectorAll(".tab");
  tabs[0].classList.toggle("active", tab === "email");
  tabs[1].classList.toggle("active", tab === "phone");
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ساخت پروفایل — فقط بار اول که کاربر ثبت‌نام می‌کنه
async function createUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      phone: user.phoneNumber || "",
      name: "کاربر جدید",
      username: "",
      bio: "",
      createdAt: Date.now()
    });
  }
}

/* ---------- ورود با ایمیل ---------- */

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

/* ---------- ورود با شماره تلفن ---------- */

window.sendCode = async function () {
  const phone = document.getElementById("phone").value.trim();
  try {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible"
      });
    }
    window.confirmationResult = await signInWithPhoneNumber(
      auth, phone, window.recaptchaVerifier
    );
    document.getElementById("code-section").style.display = "block";
    alert("کد پیامک شد ✅");
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
};

window.verifyCode = async function () {
  const code = document.getElementById("code").value.trim();
  try {
    const cred = await window.confirmationResult.confirm(code);
    await createUserProfile(cred.user);
    location.href = "chats.html";
  } catch (error) {
    alert("کد اشتباه است ❌");
  }
};

/* ---------- تب‌ها ---------- */

window.showTab = function (tab) {
  document.getElementById("email-tab").style.display = tab === "email" ? "block" : "none";
  document.getElementById("phone-tab").style.display = tab === "phone" ? "block" : "none";

  const tabs = document.querySelectorAll(".tab");
  tabs[0].classList.toggle("active", tab === "email");
  tabs[1].classList.toggle("active", tab === "phone");
};

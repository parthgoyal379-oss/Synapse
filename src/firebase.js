import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const messaging = getMessaging(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const VAPID_KEY = "BMhfG52HfwVhnYK1aY0FmHGPI7tSDhB60etg8f-bvOYS0PFpmjk21RDqNS07W6MKScQm-W3w7RwA_SOwjjSQodc";

export async function requestNotificationPermission() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
    // Register/get the FCM service worker explicitly
    let swReg;
    try {
      swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    } catch {
      swReg = await navigator.serviceWorker.getRegistration("/");
    }
    if (!swReg) return null;
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    return token || null;
  } catch (e) {
    console.warn("FCM token error:", e);
    return null;
  }
}

export { onMessage };
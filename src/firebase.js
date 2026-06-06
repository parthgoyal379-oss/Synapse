import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCJSNckvatpfSlyvy9Z8Z1DiTYTYAJAQ7c",
  authDomain: "classpredictor.firebaseapp.com",
  projectId: "classspredictor",
  storageBucket: "classpredictor.firebasestorage.app",
  messagingSenderId: "4567824313",
  appId: "1:4567824313:web:cf97fa1bdcd32f7f56a868",
  measurementId: "G-B92YNGHF2T"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
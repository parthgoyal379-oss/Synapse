/* eslint-disable no-undef */
// firebase-messaging-sw.js
//
// IMPORTANT: this file is TEMPLATED at build time. The __VITE_FIREBASE_*__
// tokens below are NOT real values in source control — Vite's
// templateFirebaseMessagingSW plugin (see vite.config.js) rewrites this
// exact file inside dist/ during `vite build`, substituting each token for
// the real value from the same VITE_FIREBASE_* env vars src/firebase.js
// already uses. Never hardcode real Firebase config here — if you do, the
// build-time substitution will simply have nothing to replace and it'll
// silently stay wrong (see the previous hardcoded-to-a-different-project
// bug this replaced).
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "__VITE_FIREBASE_API_KEY__",
  authDomain: "__VITE_FIREBASE_AUTH_DOMAIN__",
  projectId: "__VITE_FIREBASE_PROJECT_ID__",
  storageBucket: "__VITE_FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__VITE_FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__VITE_FIREBASE_APP_ID__",
});

const messaging = firebase.messaging();

// Background messages (app closed or tab not focused). Foreground messages
// are already handled by App.jsx's own onMessage() listener + FcmToast —
// this only fires when that listener isn't running.
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge } = payload.notification || {};
  const deepLink = payload.data?.deepLink || payload.fcmOptions?.link || "/";

  self.registration.showNotification(title || "SYNAPSE", {
    body: body || "",
    icon: icon || "/icon-192.png",
    badge: badge || "/icon-192.png",
    data: { deepLink },
    tag: payload.data?.type || "synapse-notification",
  });
});

// Click routing — every notification type maps to a real in-app route via
// messageGenerator.js's DEEP_LINKS table (checkin -> /checkin, weekly ->
// /report, rescueDone -> /urgelog, etc). If a SYNAPSE tab is already open,
// focus it and postMessage the deep link so App.jsx's own
// SYNAPSE_NOTIFICATION_CLICK listener navigates via goTo(); otherwise open
// a new tab directly at the deep link.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = event.notification.data?.deepLink || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "SYNAPSE_NOTIFICATION_CLICK", deepLink });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(deepLink);
      }
    })
  );
});

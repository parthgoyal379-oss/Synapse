/* eslint-disable no-undef */
// firebase-messaging-sw.js
// Registered by App.jsx at scope "/" (see navigator.serviceWorker.register
// calls already in App.jsx — this file is not new infrastructure, it's the
// static file those calls expect to find at the site root).

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Same project config App.jsx's firebase.js uses. Service workers can't
// read import.meta.env, so these are injected at build time — see the
// "Environment variables" section of the integration notes. Do NOT hardcode
// real secrets in source control; this file should be generated/templated
// during the build (Vite plugin or a small prebuild script), the same way
// many Firebase+Vite projects template this exact file.
firebase.initializeApp({
  apiKey: "__VITE_FIREBASE_API_KEY__",
  authDomain: "__VITE_FIREBASE_AUTH_DOMAIN__",
  projectId: "__VITE_FIREBASE_PROJECT_ID__",
  storageBucket: "__VITE_FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__VITE_FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__VITE_FIREBASE_APP_ID__",
});

const messaging = firebase.messaging();

// Background messages (app closed or tab not focused). Foreground
// messages are already handled by App.jsx's own onMessage() listener +
// FcmToast — this only fires when that listener isn't running.
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge } = payload.notification || {};
  const deepLink = payload.data?.deepLink || payload.fcmOptions?.link || "/";

  self.registration.showNotification(title || "SYNAPSE", {
    body: body || "",
    icon: icon || "/icons/icon-192.png",
    badge: badge || "/icons/badge-72.png",
    data: { deepLink },
    tag: payload.data?.type || "synapse-notification",
  });
});

// Click routing — every notification type maps to a real in-app route via
// messageGenerator.js's DEEP_LINKS table (checkin -> /checkin, weekly ->
// /report, rescueDone -> /urgelog, milestone -> /progress, etc). If a
// SYNAPSE tab is already open, focus it and navigate; otherwise open a
// new one at the deep link.
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

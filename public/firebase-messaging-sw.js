importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            self.FIREBASE_API_KEY            || "",
  authDomain:        self.FIREBASE_AUTH_DOMAIN        || "",
  projectId:         self.FIREBASE_PROJECT_ID         || "",
  storageBucket:     self.FIREBASE_STORAGE_BUCKET     || "",
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID|| "",
  appId:             self.FIREBASE_APP_ID             || "",
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, badge, data } = payload.notification || {};
  self.registration.showNotification(title || "SYNAPSE", {
    body:  body  || "Check in and keep your streak alive.",
    icon:  icon  || "/icon-192.png",
    badge: badge || "/icon-96.png",
    tag:   "synapse-notification",
    renotify: true,
    data: data || {},
    actions: [
      { action: "checkin", title: "✅ Check In" },
      { action: "dismiss", title: "Later"       },
    ],
  });
});

// Notification click handler
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "checkin" || !e.action) {
    e.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
        const existing = cs.find((c) => c.url.includes(self.location.origin));
        if (existing) { existing.focus(); return; }
        return clients.openWindow("/");
      })
    );
  }
});
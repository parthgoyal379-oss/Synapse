importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyCJSNckvatpfSlyvy9Z8Z1DiTYTYAJAQ7c",
  authDomain:        "classpredictor.firebaseapp.com",
  projectId:         "classpredictor",
  storageBucket:     "classpredictor.firebasestorage.app",
  messagingSenderId: "4567824313",
  appId:             "1:4567824313:web:cf97fa1bdcd32f7f56a868",
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "SYNAPSE";
  const body  = payload.notification?.body  || "Check in and keep your streak alive.";
  self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    tag:   "synapse-notification",
    renotify: true,
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: [
      { action: "checkin", title: "✅ Check In" },
      { action: "dismiss", title: "Later"       },
    ],
  });
});

// Notification click
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "dismiss") return;
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const existing = cs.find((c) => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); return; }
      return clients.openWindow("/");
    })
  );
});
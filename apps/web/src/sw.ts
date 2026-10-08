/// <reference lib="webworker" />
/**
 * Service worker: offline app shell (precache + SPA navigation fallback) and Web Push.
 * `/api/*` is never routed through Workbox, so API calls always hit the network.
 */
import { API } from '@legko/shared';
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  deviceTimeZone,
  notificationPath,
  parsePushPayload,
  urlBase64ToUint8Array,
  type NavigateMessage,
} from './pwa/protocol';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

// --- Lifecycle: a new version takes over immediately (the shell is precached, data lives on the server).

self.addEventListener('install', () => {
  void self.skipWaiting();
});
clientsClaim();

// --- Offline shell

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// --- Push

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(readPushText(event.data));
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: ICON,
      badge: BADGE,
      lang: 'uk',
      dir: 'ltr',
      ...(payload.tag ? { tag: payload.tag } : {}),
      data: { url: payload.url },
    }),
  );
});

function readPushText(data: PushMessageData | null): string | null {
  try {
    return data ? data.text() : null;
  } catch {
    return null;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openApp(notificationPath(event.notification.data)));
});

/** Focuses an open app window and routes it to `path`, or opens a new window there. */
async function openApp(path: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
  if (!client) {
    await self.clients.openWindow(new URL(path, self.location.origin).href);
    return;
  }
  let target: WindowClient = client;
  try {
    target = await client.focus();
  } catch {
    // Focusing can be refused by the browser; navigating the window is still useful.
  }
  const message: NavigateMessage = { type: 'navigate', url: path };
  target.postMessage(message);
}

// --- Subscription rotation by the push service (rare; Firefox/Chrome do it on key expiry)

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renewSubscription(event.oldSubscription, event.newSubscription));
});

async function renewSubscription(oldSub: PushSubscription | null, newSub: PushSubscription | null): Promise<void> {
  const subscription =
    newSub ??
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: oldSub?.options.applicationServerKey ?? (await fetchServerKey()),
    }));
  const timezone = deviceTimeZone();
  await postJson(API.pushSubscribe, { subscription: subscription.toJSON(), ...(timezone ? { timezone } : {}) });
}

async function fetchServerKey(): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(API.pushKey, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`push key: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const key = typeof body === 'object' && body !== null && 'key' in body ? body.key : undefined;
  if (typeof key !== 'string') throw new Error('push key: malformed response');
  return urlBase64ToUint8Array(key);
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
}

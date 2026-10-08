/**
 * Web Push on the client. Contract used by the Reminders screen (implemented by the PWA task):
 * - `needs-install` — iPhone in Safari: push only works from the home-screen app (iOS 16.4+).
 * - `enabled`       — permission granted and this device is subscribed on the server.
 */
import { DEFAULT_TIMEZONE } from '@legko/shared';
import { deviceTimeZone, sameKey, urlBase64ToUint8Array } from '../pwa/protocol';
import { api } from './api';
import { isIOS, isStandalone } from './platform';

export { urlBase64ToUint8Array } from '../pwa/protocol';

export type PushStatus = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'enabled';

/** How long `enablePush` waits for the service worker to become active before giving up. */
const SW_READY_TIMEOUT_MS = 10_000;

function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in globalThis &&
    'Notification' in globalThis
  );
}

/** Registration if one exists (never waits: in dev there is no service worker at all). */
async function existingRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration();
}

/** The active registration, waiting a little for a freshly installed worker. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Service worker is not active')), SW_READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await existingRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const timezone = (): string => deviceTimeZone() ?? DEFAULT_TIMEZONE;

async function serverKey(): Promise<Uint8Array<ArrayBuffer>> {
  const { key } = await api.pushPublicKey();
  return urlBase64ToUint8Array(key);
}

/**
 * Returns a subscription made with `key`: reuses the existing one when its key matches,
 * otherwise drops it (the server rotated its VAPID keys) and subscribes again.
 */
async function subscriptionFor(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, key)) return existing;
  if (existing) {
    const staleEndpoint = existing.endpoint;
    await existing.unsubscribe();
    void api.pushUnsubscribe(staleEndpoint).catch(() => undefined);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'enabled';
  return 'default';
}

/**
 * Asks for permission and subscribes this device. Must be called from a tap handler.
 * Resolves with the resulting status; rejects (ApiError / DOMException / Error) when permission
 * was granted but subscribing or registering on the server failed.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return getPushStatus();
  // Must run before any other await: iOS shows the prompt only inside the user gesture.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'default';

  const [reg, key] = await Promise.all([activeRegistration(), serverKey()]);
  const subscription = await subscriptionFor(reg, key);
  await api.pushSubscribe(subscription.toJSON(), timezone());
  return 'enabled';
}

/** Unsubscribes this device. The server forgets it now, or on the next send (410) if offline. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await api.pushUnsubscribe(endpoint).catch(() => undefined);
}

/** Re-sends the existing subscription after start-up (server DB reset, rotated endpoint, new time zone). */
export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  const reg = await existingRegistration();
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  const subscription = await subscriptionFor(reg, await serverKey());
  await api.pushSubscribe(subscription.toJSON(), timezone());
}

/** Sends a test notification to all subscribed devices; resolves with how many got it. */
export async function sendTestPush(): Promise<number> {
  const { sent } = await api.pushTest();
  return sent;
}

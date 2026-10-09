/** Registers the service worker (offline shell + push). */
import { navigate } from 'wouter/use-browser-location';
import { syncPushSubscription } from '../lib/push';
import { isNavigateMessage, safeAppPath } from './protocol';
import { reloadOnUpdate } from './update';

/** Built by vite-plugin-pwa from `src/sw.ts` as a classic (IIFE) script. */
const SW_URL = '/sw.js';
/** Don't ask the browser to re-check `sw.js` more often than this when the app comes back. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Listen before registering so a notification tap that launched the app is not missed.
  navigator.serviceWorker.addEventListener('message', onWorkerMessage);
  navigator.serviceWorker.startMessages();

  // A deployed version takes over at once (sw.ts); move the page onto it at the next quiet return.
  // Set up before registering: it needs to know whether this page started under a worker.
  reloadOnUpdate({ serviceWorker: navigator.serviceWorker, document });

  // Registering after `load` keeps the first render free of the precache download.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

function onWorkerMessage(event: MessageEvent<unknown>): void {
  if (isNavigateMessage(event.data)) navigate(safeAppPath(event.data.url));
}

async function register(): Promise<void> {
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });
  } catch (err) {
    console.warn('[pwa] service worker registration failed', err);
    return;
  }
  const push = pushSyncer();
  push.run();
  onForeground(() => {
    checkForUpdate(registration);
    push.run();
  });
}

/**
 * Re-sends the push subscription once per app session. A failure (offline, not logged in yet)
 * is retried on the next foreground.
 */
function pushSyncer(): { run: () => void } {
  let state: 'idle' | 'running' | 'done' = 'idle';
  return {
    run() {
      if (state !== 'idle' || !('Notification' in window) || Notification.permission !== 'granted') return;
      state = 'running';
      syncPushSubscription().then(
        () => {
          state = 'done';
        },
        () => {
          state = 'idle';
        },
      );
    },
  };
}

let lastUpdateCheck = Date.now();

function checkForUpdate(registration: ServiceWorkerRegistration): void {
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  registration.update().catch(() => undefined);
}

function onForeground(cb: () => void): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cb();
  });
}

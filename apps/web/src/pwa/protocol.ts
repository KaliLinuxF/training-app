/**
 * Pure helpers shared by the service worker (`src/sw.ts`, WebWorker lib) and the app (DOM lib).
 * Keep this file free of DOM- or worker-only globals so it type-checks under both.
 */

/** Title used when a push arrives without a usable payload. */
export const DEFAULT_NOTIFICATION_TITLE = 'Легко';

export interface NotificationPayload {
  title: string;
  body: string;
  /** Same-origin path (with query) to open when the notification is tapped. */
  url: string;
  tag: string | undefined;
}

/** Message the service worker posts to an open window after a notification tap. */
export interface NavigateMessage {
  type: 'navigate';
  url: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Only app-relative paths are accepted (`/…`, not `//host` or `https://…`), so a payload
 * can never send the user to another site. Anything else falls back to the home screen.
 */
export function safeAppPath(v: unknown): string {
  const s = nonEmpty(v);
  if (!s || !s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return '/';
  return s;
}

/**
 * Parses the server's push payload `{ title, body, url, tag }` (SPEC §3.3).
 * Never throws: iOS revokes the subscription if a push does not show a notification,
 * so even a broken payload must produce something displayable. Plain text becomes the body.
 */
export function parsePushPayload(raw: string | null | undefined): NotificationPayload {
  let data: unknown = undefined;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { body: raw };
    }
  }
  const obj = isRecord(data) ? data : {};
  return {
    title: nonEmpty(obj.title) ?? DEFAULT_NOTIFICATION_TITLE,
    body: typeof obj.body === 'string' ? obj.body : '',
    url: safeAppPath(obj.url),
    tag: nonEmpty(obj.tag),
  };
}

/** Reads the URL stored in `Notification#data` by the push handler. */
export function notificationPath(data: unknown): string {
  return safeAppPath(isRecord(data) ? data.url : undefined);
}

export function isNavigateMessage(v: unknown): v is NavigateMessage {
  return isRecord(v) && v.type === 'navigate' && typeof v.url === 'string';
}

/** Decodes a base64url VAPID public key into the bytes `PushManager#subscribe` expects. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64url.trim();
  const padding = '='.repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Whether a subscription's `applicationServerKey` equals the server's current key. */
export function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.byteLength) return false;
  const a = new Uint8Array(current);
  return a.every((byte, i) => byte === expected[i]);
}

/** IANA zone of this device, sent with the subscription so the server fires reminders on local time. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

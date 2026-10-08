/**
 * Web Push on the client. Contract used by the Reminders screen (implemented by the PWA task):
 * - `needs-install` — iPhone in Safari: push only works from the home-screen app (iOS 16.4+).
 * - `enabled`       — permission granted and this device is subscribed on the server.
 */
export type PushStatus = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'enabled';

export async function getPushStatus(): Promise<PushStatus> {
  return 'unsupported';
}

/** Asks for permission and subscribes this device. Must be called from a tap handler. */
export async function enablePush(): Promise<PushStatus> {
  return getPushStatus();
}

export async function disablePush(): Promise<void> {}

/** Re-sends the existing subscription after start-up (server DB reset, rotated endpoint, new time zone). */
export async function syncPushSubscription(): Promise<void> {}

/** Sends a test notification to all subscribed devices; resolves with how many got it. */
export async function sendTestPush(): Promise<number> {
  return 0;
}

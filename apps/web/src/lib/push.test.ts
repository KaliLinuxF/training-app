import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { isIOS, isStandalone } from './platform';
import {
  disablePush,
  enablePush,
  getPushStatus,
  sendTestPush,
  syncPushSubscription,
  urlBase64ToUint8Array,
} from './push';

vi.mock('./platform', () => ({ isIOS: vi.fn(() => false), isStandalone: vi.fn(() => false) }));
vi.mock('./api', () => ({
  api: {
    pushPublicKey: vi.fn(),
    pushSubscribe: vi.fn(),
    pushUnsubscribe: vi.fn(),
    pushTest: vi.fn(),
  },
}));

const SERVER_KEY = 'BAECAw'; // bytes [4, 1, 2, 3]
const OTHER_KEY = Uint8Array.from([4, 9, 9, 9]);

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
}

function fakeSubscription(endpoint: string, key: Uint8Array<ArrayBuffer>): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

interface Env {
  permission: NotificationPermission;
  /** Result of `Notification.requestPermission()`. */
  grant?: NotificationPermission;
  subscription?: FakeSubscription | null;
  /** `false` = no service worker registered (dev). */
  registered?: boolean;
}

function installEnv({ permission, grant = 'granted', subscription = null, registered = true }: Env) {
  const created = fakeSubscription('https://push.example/new', urlBase64ToUint8Array(SERVER_KEY));
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async () => created),
  };
  const registration = { pushManager };
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn(async () => (registered ? registration : undefined)),
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => grant) });
  return { pushManager, created };
}

const requestPermission = () => (globalThis as unknown as { Notification: { requestPermission: () => unknown } }).Notification.requestPermission;

beforeEach(() => {
  vi.mocked(api.pushPublicKey).mockResolvedValue({ key: SERVER_KEY });
  vi.mocked(api.pushSubscribe).mockResolvedValue({ ok: true });
  vi.mocked(api.pushUnsubscribe).mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(isIOS).mockReturnValue(false);
  vi.mocked(isStandalone).mockReturnValue(false);
});

describe('getPushStatus', () => {
  it('is "unsupported" without the Push API on a non-iOS browser', async () => {
    // jsdom has neither PushManager nor Notification nor navigator.serviceWorker.
    expect(await getPushStatus()).toBe('unsupported');
  });

  it('is "needs-install" in iPhone Safari (no Push API outside the home-screen app)', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    vi.mocked(isStandalone).mockReturnValue(false);
    expect(await getPushStatus()).toBe('needs-install');
  });

  it('is "needs-install" in an iPhone browser tab even when it exposes the Push API', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    vi.mocked(isStandalone).mockReturnValue(false);
    installEnv({ permission: 'granted', subscription: fakeSubscription('https://push.example/a', OTHER_KEY) });
    expect(await getPushStatus()).toBe('needs-install');
  });

  it('reports the real state in the installed iPhone app', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    vi.mocked(isStandalone).mockReturnValue(true);
    installEnv({ permission: 'granted', subscription: fakeSubscription('https://push.example/a', OTHER_KEY) });
    expect(await getPushStatus()).toBe('enabled');
  });

  it('is "unsupported" in an installed iPhone app without the Push API (iOS < 16.4)', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    vi.mocked(isStandalone).mockReturnValue(true);
    expect(await getPushStatus()).toBe('unsupported');
  });

  it('is "denied" when notifications are blocked', async () => {
    installEnv({ permission: 'denied' });
    expect(await getPushStatus()).toBe('denied');
  });

  it('is "default" before the user was asked', async () => {
    installEnv({ permission: 'default' });
    expect(await getPushStatus()).toBe('default');
  });

  it('is "default" when permission is granted but this device is not subscribed', async () => {
    installEnv({ permission: 'granted', subscription: null });
    expect(await getPushStatus()).toBe('default');
  });

  it('is "default" when no service worker is registered', async () => {
    installEnv({ permission: 'granted', registered: false });
    expect(await getPushStatus()).toBe('default');
  });

  it('is "enabled" when granted and subscribed', async () => {
    installEnv({ permission: 'granted', subscription: fakeSubscription('https://push.example/a', OTHER_KEY) });
    expect(await getPushStatus()).toBe('enabled');
  });
});

describe('enablePush', () => {
  it('asks for permission synchronously, subscribes with the server key and registers on the server', async () => {
    const { pushManager, created } = installEnv({ permission: 'default', grant: 'granted' });
    const pending = enablePush();
    // Still inside the tap handler's synchronous part: iOS requires this.
    expect(requestPermission()).toHaveBeenCalledTimes(1);

    expect(await pending).toBe('enabled');
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(SERVER_KEY),
    });
    expect(api.pushSubscribe).toHaveBeenCalledWith(created.toJSON(), expect.any(String));
  });

  it('returns "denied" / "default" and does not subscribe when the user refuses or dismisses', async () => {
    const denied = installEnv({ permission: 'default', grant: 'denied' });
    expect(await enablePush()).toBe('denied');
    expect(denied.pushManager.subscribe).not.toHaveBeenCalled();

    const dismissed = installEnv({ permission: 'default', grant: 'default' });
    expect(await enablePush()).toBe('default');
    expect(dismissed.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });

  it('reuses an existing subscription made with the current key', async () => {
    const existing = fakeSubscription('https://push.example/old', urlBase64ToUint8Array(SERVER_KEY));
    const { pushManager } = installEnv({ permission: 'granted', subscription: existing });
    expect(await enablePush()).toBe('enabled');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.pushSubscribe).toHaveBeenCalledWith(existing.toJSON(), expect.any(String));
  });

  it('does not touch the Push API where it is unavailable', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    expect(await enablePush()).toBe('needs-install');
    expect(api.pushPublicKey).not.toHaveBeenCalled();
  });

  it('does not ask for permission in an iPhone browser tab that exposes the Push API', async () => {
    vi.mocked(isIOS).mockReturnValue(true);
    vi.mocked(isStandalone).mockReturnValue(false);
    const { pushManager } = installEnv({ permission: 'default', grant: 'granted' });
    expect(await enablePush()).toBe('needs-install');
    expect(requestPermission()).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });

  it('rejects when the server cannot be reached', async () => {
    installEnv({ permission: 'default', grant: 'granted' });
    vi.mocked(api.pushPublicKey).mockRejectedValue(new Error('offline'));
    await expect(enablePush()).rejects.toThrow('offline');
  });
});

describe('syncPushSubscription', () => {
  it('re-posts an existing subscription', async () => {
    const existing = fakeSubscription('https://push.example/a', urlBase64ToUint8Array(SERVER_KEY));
    const { pushManager } = installEnv({ permission: 'granted', subscription: existing });
    await syncPushSubscription();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.pushSubscribe).toHaveBeenCalledWith(existing.toJSON(), expect.any(String));
  });

  it('resubscribes when the server key changed', async () => {
    const stale = fakeSubscription('https://push.example/stale', OTHER_KEY);
    const { pushManager, created } = installEnv({ permission: 'granted', subscription: stale });
    await syncPushSubscription();
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(api.pushUnsubscribe).toHaveBeenCalledWith('https://push.example/stale');
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(api.pushSubscribe).toHaveBeenCalledWith(created.toJSON(), expect.any(String));
  });

  it('does nothing without permission or without a subscription', async () => {
    installEnv({ permission: 'default', subscription: fakeSubscription('https://push.example/a', OTHER_KEY) });
    await syncPushSubscription();
    installEnv({ permission: 'granted', subscription: null });
    await syncPushSubscription();
    expect(api.pushPublicKey).not.toHaveBeenCalled();
    expect(api.pushSubscribe).not.toHaveBeenCalled();
  });
});

describe('disablePush', () => {
  it('unsubscribes locally and tells the server', async () => {
    const existing = fakeSubscription('https://push.example/a', OTHER_KEY);
    installEnv({ permission: 'granted', subscription: existing });
    await disablePush();
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(api.pushUnsubscribe).toHaveBeenCalledWith('https://push.example/a');
  });

  it('still succeeds when the server is unreachable', async () => {
    const existing = fakeSubscription('https://push.example/a', OTHER_KEY);
    installEnv({ permission: 'granted', subscription: existing });
    vi.mocked(api.pushUnsubscribe).mockRejectedValue(new Error('offline'));
    await expect(disablePush()).resolves.toBeUndefined();
    expect(existing.unsubscribe).toHaveBeenCalled();
  });
});

describe('sendTestPush', () => {
  it('resolves with the number of devices reached', async () => {
    vi.mocked(api.pushTest).mockResolvedValue({ ok: true, sent: 2 });
    expect(await sendTestPush()).toBe(2);
  });
});

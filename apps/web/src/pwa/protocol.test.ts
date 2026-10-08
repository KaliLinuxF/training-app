import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_TITLE,
  isNavigateMessage,
  notificationPath,
  parsePushPayload,
  safeAppPath,
  sameKey,
  urlBase64ToUint8Array,
} from './protocol';

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('urlBase64ToUint8Array', () => {
  it('decodes unpadded base64url', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQ')]).toEqual([1]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
  });

  it('maps the url-safe alphabet back to + and /', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff]);
  });

  it('accepts already padded input and surrounding whitespace', () => {
    expect([...urlBase64ToUint8Array(' AQ== ')]).toEqual([1]);
  });

  it('round-trips a 65-byte P-256 VAPID public key', () => {
    const key = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
    key[0] = 0x04; // uncompressed point marker
    const encoded = toBase64Url(key);
    expect(encoded).toHaveLength(87);
    expect(urlBase64ToUint8Array(encoded)).toEqual(key);
  });

  it('throws on characters outside the alphabet', () => {
    expect(() => urlBase64ToUint8Array('***')).toThrow();
  });
});

describe('sameKey', () => {
  const key = Uint8Array.from([4, 1, 2, 3]);

  it('is true for identical bytes', () => {
    expect(sameKey(Uint8Array.from([4, 1, 2, 3]).buffer, key)).toBe(true);
  });

  it('is false for a different key, length or a missing key', () => {
    expect(sameKey(Uint8Array.from([4, 1, 2, 9]).buffer, key)).toBe(false);
    expect(sameKey(Uint8Array.from([4, 1, 2]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe('parsePushPayload', () => {
  it('reads the server payload', () => {
    const raw = JSON.stringify({ title: 'Контрольне зважування ⚖️', body: 'Найточніше — зранку', url: '/?sheet=weight', tag: 'weigh' });
    expect(parsePushPayload(raw)).toEqual({
      title: 'Контрольне зважування ⚖️',
      body: 'Найточніше — зранку',
      url: '/?sheet=weight',
      tag: 'weigh',
    });
  });

  it('falls back to the app name and home screen for an empty push', () => {
    expect(parsePushPayload(null)).toEqual({ title: DEFAULT_NOTIFICATION_TITLE, body: '', url: '/', tag: undefined });
    expect(parsePushPayload('')).toEqual({ title: DEFAULT_NOTIFICATION_TITLE, body: '', url: '/', tag: undefined });
  });

  it('uses plain text as the body', () => {
    expect(parsePushPayload('Привіт')).toMatchObject({ title: DEFAULT_NOTIFICATION_TITLE, body: 'Привіт', url: '/' });
  });

  it('ignores fields of the wrong type', () => {
    const raw = JSON.stringify({ title: 42, body: null, url: ['x'], tag: '  ' });
    expect(parsePushPayload(raw)).toEqual({ title: DEFAULT_NOTIFICATION_TITLE, body: '', url: '/', tag: undefined });
  });

  it('ignores JSON that is not an object', () => {
    expect(parsePushPayload('[1,2]')).toMatchObject({ title: DEFAULT_NOTIFICATION_TITLE, url: '/' });
    expect(parsePushPayload('"text"')).toMatchObject({ title: DEFAULT_NOTIFICATION_TITLE, url: '/' });
  });
});

describe('safeAppPath', () => {
  it('keeps app-relative paths with a query', () => {
    expect(safeAppPath('/?sheet=day&trained=1')).toBe('/?sheet=day&trained=1');
    expect(safeAppPath('/reminders')).toBe('/reminders');
  });

  it('rejects anything that could leave the app', () => {
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'reminders', '', 7, null]) {
      expect(safeAppPath(bad)).toBe('/');
    }
  });
});

describe('notificationPath', () => {
  it('reads data.url and defaults to the home screen', () => {
    expect(notificationPath({ url: '/?sheet=measure' })).toBe('/?sheet=measure');
    expect(notificationPath(undefined)).toBe('/');
    expect(notificationPath({ url: 'https://evil.example' })).toBe('/');
  });
});

describe('isNavigateMessage', () => {
  it('accepts only { type: "navigate", url: string }', () => {
    expect(isNavigateMessage({ type: 'navigate', url: '/' })).toBe(true);
    expect(isNavigateMessage({ type: 'navigate' })).toBe(false);
    expect(isNavigateMessage({ type: 'other', url: '/' })).toBe(false);
    expect(isNavigateMessage('navigate')).toBe(false);
    expect(isNavigateMessage(null)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAuthEnv } from './env';
import { captureLinkToken, clearLinkToken, LINK_TOKEN_KEY, linkKindOf, storeLinkToken } from './linkToken';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = setAuthEnv({ session: () => sessionStorage });
  sessionStorage.clear();
});

afterEach(() => {
  restoreEnv();
  window.history.replaceState(null, '', '/');
});

describe('link tokens', () => {
  it('knows the link pages', () => {
    expect(linkKindOf('/invite')).toBe('invite');
    expect(linkKindOf('/reset')).toBe('reset');
    expect(linkKindOf('/')).toBeNull();
    expect(linkKindOf('/invite/x')).toBeNull();
  });

  it('moves a fragment token to sessionStorage and strips the fragment (state kept)', () => {
    window.history.replaceState({ keep: 1 }, '', `/invite#${TOKEN}`);
    expect(captureLinkToken('invite')).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');
    expect(window.history.state).toEqual({ keep: 1 });
    expect(JSON.parse(sessionStorage.getItem(LINK_TOKEN_KEY) ?? 'null')).toEqual({ kind: 'invite', token: TOKEN });
    // A reload: no fragment any more, the stored token is used.
    expect(captureLinkToken('invite')).toBe(TOKEN);
    expect(captureLinkToken('reset')).toBeNull();
  });

  it('a damaged fragment answers null, is stripped and forgets an older token', () => {
    storeLinkToken({ kind: 'invite', token: TOKEN });
    window.history.replaceState(null, '', '/invite#too-short');
    expect(captureLinkToken('invite')).toBeNull();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('ignores garbage in sessionStorage and survives blocked storage', () => {
    window.history.replaceState(null, '', '/reset');
    sessionStorage.setItem(LINK_TOKEN_KEY, '{nope');
    expect(captureLinkToken('reset')).toBeNull();
    sessionStorage.setItem(LINK_TOKEN_KEY, JSON.stringify({ kind: 'reset', token: 'short' }));
    expect(captureLinkToken('reset')).toBeNull();

    restoreEnv();
    restoreEnv = setAuthEnv({ session: () => null });
    window.history.replaceState(null, '', `/reset#${TOKEN}`);
    expect(captureLinkToken('reset')).toBe(TOKEN);
    expect(() => clearLinkToken()).not.toThrow();
  });
});

/**
 * One-time link tokens (D4, docs/multi-user.md §8.4): `/invite#<token>`, `/reset#<token>`. The token travels in the
 * URL fragment (never sent to the server or its logs); on arrival the SPA moves it to sessionStorage and strips it
 * from the address bar, so a reload still finds it while a copy of the URL does not carry it.
 */
import { LINK_PATHS, tokenFromHash, type LinkKind } from '@legko/shared';
import { authEnv } from './env';

/** sessionStorage: the link being completed (`{ kind, token }`). */
export const LINK_TOKEN_KEY = 'legko.linkToken';

export interface StoredLink {
  kind: LinkKind;
  token: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function readStored(): StoredLink | null {
  try {
    const raw = authEnv().session()?.getItem(LINK_TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredLink> | null;
    if (!value || typeof value.token !== 'string' || !TOKEN_RE.test(value.token)) return null;
    if (value.kind !== 'invite' && value.kind !== 'reset') return null;
    return { kind: value.kind, token: value.token };
  } catch {
    return null;
  }
}

/** Remembers the link being completed (a reload, or the pasted-link path from the login screen, reads it back). */
export function storeLinkToken(link: StoredLink): void {
  try {
    authEnv().session()?.setItem(LINK_TOKEN_KEY, JSON.stringify(link));
  } catch {
    // Storage blocked: this page still has the token in memory.
  }
}

/** Forgets the link (it was used, or she left the link screen). */
export function clearLinkToken(): void {
  try {
    authEnv().session()?.removeItem(LINK_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** The link path for `pathname` (`/invite` → 'invite'), or null for every other page. */
export function linkKindOf(pathname: string): LinkKind | null {
  const kind = (Object.keys(LINK_PATHS) as LinkKind[]).find((k) => LINK_PATHS[k] === pathname);
  return kind ?? null;
}

/**
 * On a link screen's mount: a token in `location.hash` is moved to sessionStorage and the fragment is stripped
 * (`history.replaceState` to the bare path); without a fragment the stored token of the same kind is used. A
 * fragment that is not a token (a damaged link) answers null and forgets any stored one.
 */
export function captureLinkToken(kind: LinkKind): string | null {
  const { hash } = window.location;
  if (hash && hash !== '#') {
    const token = tokenFromHash(hash);
    window.history.replaceState(window.history.state, '', LINK_PATHS[kind]);
    if (token === null) {
      clearLinkToken();
      return null;
    }
    storeLinkToken({ kind, token });
    return token;
  }
  const stored = readStored();
  return stored?.kind === kind ? stored.token : null;
}

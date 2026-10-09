import { useCallback, useState } from 'react';

/** Per-device appearance preference (not synced to the server). */
export type ThemePref = 'auto' | 'light' | 'dark';

// public/theme-boot.js repeats the key, the colours and applyTheme() to set a forced theme before
// the first paint; src/pwa/theme-boot.test.ts keeps the two in step.
const KEY = 'legko.theme';
const PAPER = { light: '#F3F5F8', dark: '#12151A' } as const;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Sets `data-theme` on <html> and keeps the iOS status-bar colour (`theme-color`) in sync. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m) => {
    const media = m.getAttribute('media') ?? '';
    const forDark = media.includes('dark');
    m.content = pref === 'auto' ? (forDark ? PAPER.dark : PAPER.light) : PAPER[pref];
  });
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const set = useCallback((p: ThemePref) => {
    try {
      if (p === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      // private mode: still apply for this session
    }
    applyTheme(p);
    setPref(p);
  }, []);
  return [pref, set];
}

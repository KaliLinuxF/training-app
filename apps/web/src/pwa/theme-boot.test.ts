import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import bootSource from '../../public/theme-boot.js?raw';
import { applyTheme, getThemePref } from '../lib/theme';

/** The page's <head> as the browser parses it (theme-color metas with their media queries). */
function loadHead(): void {
  const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.documentElement.removeAttribute('data-theme');
}

/** What the boot script and applyTheme() control: `data-theme` and the status-bar colours. */
function snapshot(): { theme: string | null; colors: string[] } {
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    colors: [...document.querySelectorAll('meta[name="theme-color"]')].map(
      (m) => m.getAttribute('content') ?? '',
    ),
  };
}

const runBoot = (): void => new Function(bootSource)();

beforeEach(() => {
  localStorage.clear();
  loadHead();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('public/theme-boot.js', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['auto (nothing stored)', null],
    ['an unknown value', 'sepia'],
  ])('matches applyTheme(getThemePref()) for %s', (_label, stored) => {
    if (stored !== null) localStorage.setItem('legko.theme', stored);
    runBoot();
    const boot = snapshot();

    loadHead();
    applyTheme(getThemePref());
    expect(boot).toEqual(snapshot());
  });

  it('forces both status-bar colours to the chosen paper', () => {
    localStorage.setItem('legko.theme', 'dark');
    runBoot();
    expect(snapshot()).toEqual({ theme: 'dark', colors: ['#12151A', '#12151A'] });
  });

  it('leaves the system-based markup alone when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const before = snapshot();
    expect(runBoot).not.toThrow();
    expect(snapshot()).toEqual(before);
    expect(before).toEqual({ theme: null, colors: ['#F3F5F8', '#12151A'] });
  });
});

describe('index.html', () => {
  const head = new DOMParser().parseFromString(indexHtml, 'text/html').head;
  const boot = head.querySelector<HTMLScriptElement>('script[src="/theme-boot.js"]');

  it('loads the boot script as a blocking classic script in <head>', () => {
    expect(boot).not.toBeNull();
    for (const attr of ['type', 'async', 'defer']) expect(boot?.hasAttribute(attr), attr).toBe(false);
  });

  it('places it after the theme-color metas it updates and before any stylesheet', () => {
    const order = [...head.querySelectorAll('meta[name="theme-color"], link[rel="stylesheet"], script')];
    const at = order.indexOf(boot!);
    expect(order.slice(0, at).every((el) => el.matches('meta[name="theme-color"]'))).toBe(true);
    expect(at).toBe(2);
  });
});

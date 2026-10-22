import type { IconName } from '@/ui';

export interface NavItem {
  href: '/' | '/calendar' | '/progress' | '/coach' | '/settings';
  label: string;
  /** Tab-bar glyph (kit `Icon`). */
  icon: IconName;
}

/** Main sections, in tab-bar / sidebar order (the «+» sits after the first `NAV_SPLIT` of them on mobile). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Головна', icon: 'home' },
  { href: '/calendar', label: 'Календар', icon: 'calendar' },
  { href: '/progress', label: 'Прогрес', icon: 'chart' },
  { href: '/settings', label: 'Налаштування', icon: 'gear' },
];

/** The coach's read-only cabinet (admins only, docs/coach-cabinet.md §5.2). */
export const COACH_NAV_ITEM: NavItem = { href: '/coach', label: 'Клієнти', icon: 'users' };

/** Admin sidebar: the four sections with «Клієнти» before «Налаштування». */
const ADMIN_SIDEBAR: readonly NavItem[] = [
  ...NAV_ITEMS.filter((item) => item.href !== '/settings'),
  COACH_NAV_ITEM,
  ...NAV_ITEMS.filter((item) => item.href === '/settings'),
];

/** Admin tab bar: «Клієнти» in place of «Прогрес» (her own Progress stays one tap away from Home's week row). */
const ADMIN_TABBAR: readonly NavItem[] = NAV_ITEMS.map((item) =>
  item.href === '/progress' ? COACH_NAV_ITEM : item,
);

/**
 * The sections a person sees: everyone else gets `NAV_ITEMS` unchanged; an admin gets «Клієнти» too — as a fifth
 * sidebar link (before «Налаштування») or, on the phone, in place of «Прогрес» (the tab bar keeps four tabs + «+»).
 */
export function navItems(isAdmin: boolean, place: 'sidebar' | 'tabbar'): readonly NavItem[] {
  if (!isAdmin) return NAV_ITEMS;
  return place === 'sidebar' ? ADMIN_SIDEBAR : ADMIN_TABBAR;
}

/** How many sections sit left of the tab bar's «+» (Головна, Календар | + | Прогрес, Налаштування). */
export const NAV_SPLIT = 2;

/** Whether `href` is the current section for a wouter `location` (pathname, no query); sub-pages count. */
export function isNavActive(href: NavItem['href'], location: string): boolean {
  if (href === '/') return location === '/' || location === '';
  return location === href || location.startsWith(`${href}/`);
}

/** Whether `location` is the section root `href` itself (not one of its sub-pages such as `/settings/goals`). */
export function isNavRoot(href: NavItem['href'], location: string): boolean {
  if (href === '/') return location === '/' || location === '';
  return location === href;
}

/** The wide desktop shell (up to 1440px) for the coach's table and client pages. */
export const isWidePage = (location: string): boolean =>
  location === '/coach' || location.startsWith('/coach/');

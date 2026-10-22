import type { IconName } from '@/ui';

export interface NavItem {
  href: '/' | '/calendar' | '/progress' | '/workouts' | '/coach' | '/settings';
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

/**
 * «Мої тренування» (`/workouts`): a desktop sidebar link only (W11) — the phone tab bar keeps its four tabs + «+», and
 * reaches the workouts from Home, the «Тренування» sheet and Settings.
 */
export const WORKOUTS_NAV_ITEM: NavItem = { href: '/workouts', label: 'Тренування', icon: 'workout' };

/** The sections before «Налаштування», then `extra`, then «Налаштування». */
const withBeforeSettings = (...extra: NavItem[]): readonly NavItem[] => [
  ...NAV_ITEMS.filter((item) => item.href !== '/settings'),
  ...extra,
  ...NAV_ITEMS.filter((item) => item.href === '/settings'),
];

/** Sidebar: the four sections with «Тренування» after «Прогрес». */
const USER_SIDEBAR: readonly NavItem[] = withBeforeSettings(WORKOUTS_NAV_ITEM);

/** Admin sidebar: «Тренування» after «Прогрес», then «Клієнти», before «Налаштування». */
const ADMIN_SIDEBAR: readonly NavItem[] = withBeforeSettings(WORKOUTS_NAV_ITEM, COACH_NAV_ITEM);

/** Admin tab bar: «Клієнти» in place of «Прогрес» (her own Progress stays one tap away from Home's week row). */
const ADMIN_TABBAR: readonly NavItem[] = NAV_ITEMS.map((item) =>
  item.href === '/progress' ? COACH_NAV_ITEM : item,
);

/**
 * The sections a person sees. The tab bar: `NAV_ITEMS` unchanged, or for an admin «Клієнти» in place of «Прогрес» (four
 * tabs + «+»). The desktop sidebar adds «Тренування» after «Прогрес», and for an admin «Клієнти» before «Налаштування».
 */
export function navItems(isAdmin: boolean, place: 'sidebar' | 'tabbar'): readonly NavItem[] {
  if (place === 'tabbar') return isAdmin ? ADMIN_TABBAR : NAV_ITEMS;
  return isAdmin ? ADMIN_SIDEBAR : USER_SIDEBAR;
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

/**
 * Full-screen workouts pages without the phone tab bar (W15): the session (live, summary, edit), the past-day log and
 * the builder have their own back link and sticky footer, and «+» must not open sheets mid-workout.
 */
export function hidesTabBar(location: string): boolean {
  return (
    location.startsWith('/workouts/session/') ||
    location === '/workouts/log' ||
    location === '/workouts/new' ||
    location.startsWith('/workouts/edit/')
  );
}

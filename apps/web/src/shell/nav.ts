import type { IconName } from '@/ui';

export interface NavItem {
  href: '/' | '/calendar' | '/progress' | '/settings';
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

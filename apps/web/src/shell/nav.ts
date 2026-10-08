export interface NavItem {
  href: '/' | '/calendar' | '/progress' | '/reminders';
  label: string;
}

/** Main sections, in tab-bar / sidebar order (the «+» sits between Календар and Прогрес on mobile). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Головна' },
  { href: '/calendar', label: 'Календар' },
  { href: '/progress', label: 'Прогрес' },
  { href: '/reminders', label: 'Нагадування' },
];

/** Whether `href` is the current section for a wouter `location` (pathname, no query). */
export function isNavActive(href: NavItem['href'], location: string): boolean {
  if (href === '/') return location === '/' || location === '';
  return location === href || location.startsWith(`${href}/`);
}

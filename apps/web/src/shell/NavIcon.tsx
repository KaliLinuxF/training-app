import type { NavItem } from './nav';

/** 24px line icons for the tab bar, drawn in currentColor (1.8px stroke, round joins — soft like the 1b shapes). */
const PATHS: Record<NavItem['href'], string[]> = {
  '/': ['M3.5 10.6 12 4l8.5 6.6', 'M5.8 9.2V19a1 1 0 0 0 1 1H10v-5.2a2 2 0 0 1 4 0V20h3.2a1 1 0 0 0 1-1V9.2'],
  '/calendar': [
    'M7 3.8v3.4',
    'M17 3.8v3.4',
    'M4.2 9.8h15.6',
    'M7.2 5.6h9.6a3 3 0 0 1 3 3v8.6a3 3 0 0 1-3 3H7.2a3 3 0 0 1-3-3V8.6a3 3 0 0 1 3-3Z',
    'M8.2 13.6h.01',
    'M12 13.6h.01',
    'M15.8 13.6h.01',
    'M8.2 17h.01',
    'M12 17h.01',
  ],
  '/progress': ['M4.5 19.5h15', 'M5.5 15.4 10 10.8l3.4 3.3 5.6-6.2', 'M15.4 7.9H19v3.6'],
  '/reminders': ['M6.4 16.4v-5.1a5.6 5.6 0 0 1 11.2 0v5.1l1.6 2.1H4.8Z', 'M10 21a2.2 2.2 0 0 0 4 0'],
};

export function NavIcon({ href }: { href: NavItem['href'] }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[href].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

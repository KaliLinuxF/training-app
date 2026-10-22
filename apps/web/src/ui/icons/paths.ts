/*! @license Lucide «settings» icon (the `gear` path below, scaled ×0.9 around the centre) — ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/**
 * Line icons of the kit: 24×24 grid, content inside 3–21, drawn with `stroke="currentColor"` (1.8px, round caps and
 * joins — soft like the 1b shapes). `home`, `calendar`, `chart` and `bell` are the tab-bar glyphs from
 * `shell/NavIcon.tsx`; `gear` is the ISC-licensed lucide «settings» cog scaled into the 3–21 box (no dependency).
 * `user`, `users`, `link` and `key` are the account glyphs («Акаунт», «Користувачі», one-time links).
 */
export type IconName =
  | 'home'
  | 'calendar'
  | 'chart'
  | 'gear'
  | 'food'
  | 'workout'
  | 'weight'
  | 'measure'
  | 'notes'
  | 'bell'
  | 'target'
  | 'theme'
  | 'data'
  | 'logout'
  | 'user'
  | 'users'
  | 'link'
  | 'key'
  | 'chevronRight'
  | 'chevronLeft'
  // workouts and steps (own drawings, same grid and stroke)
  | 'steps'
  | 'play'
  | 'timer'
  | 'search'
  | 'plus'
  | 'grip'
  | 'arrowUp'
  | 'arrowDown'
  | 'more'
  | 'copy'
  | 'trash'
  | 'check'
  | 'trophy'
  | 'flame';

export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  // Tab bar / sidebar
  home: [
    'M3.5 10.6 12 4l8.5 6.6',
    'M5.8 9.2V19a1 1 0 0 0 1 1H10v-5.2a2 2 0 0 1 4 0V20h3.2a1 1 0 0 0 1-1V9.2',
  ],
  calendar: [
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
  chart: ['M4.5 19.5h15', 'M5.5 15.4 10 10.8l3.4 3.3 5.6-6.2', 'M15.4 7.9H19v3.6'],
  gear: [
    'M12.198 3h-.396a1.8 1.8 0 0 0-1.8 1.8v.162a1.8 1.8 0 0 1-.9 1.557l-.387.225a1.8 1.8 0 0 1-1.8 0l-.135-.072a1.8 1.8 0 0 0-2.457.657l-.198.342a1.8 1.8 0 0 0 .657 2.457l.135.09a1.8 1.8 0 0 1 .9 1.548v.459a1.8 1.8 0 0 1-.9 1.566l-.135.081a1.8 1.8 0 0 0-.657 2.457l.198.342a1.8 1.8 0 0 0 2.457.657l.135-.072a1.8 1.8 0 0 1 1.8 0l.387.225a1.8 1.8 0 0 1 .9 1.557V19.2a1.8 1.8 0 0 0 1.8 1.8h.396a1.8 1.8 0 0 0 1.8-1.8v-.162a1.8 1.8 0 0 1 .9-1.557l.387-.225a1.8 1.8 0 0 1 1.8 0l.135.072a1.8 1.8 0 0 0 2.457-.657l.198-.351a1.8 1.8 0 0 0-.657-2.457l-.135-.072a1.8 1.8 0 0 1-.9-1.566v-.45a1.8 1.8 0 0 1 .9-1.566l.135-.081a1.8 1.8 0 0 0 .657-2.457l-.198-.342a1.8 1.8 0 0 0-2.457-.657l-.135.072a1.8 1.8 0 0 1-1.8 0l-.387-.225a1.8 1.8 0 0 1-.9-1.557V4.8a1.8 1.8 0 0 0-1.8-1.8Z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  ],

  // Actions and day rows
  /** Bowl (rim + body) with two steam strokes. */
  food: [
    'M3.5 12h17',
    'M5 12a7 7 0 0 0 14 0',
    'M9.6 3.5c-1.2 1.5 1.2 3 0 4.5',
    'M14.4 3.5c-1.2 1.5 1.2 3 0 4.5',
  ],
  /** Dumbbell: two plates per side on a bar. */
  workout: ['M6.5 8v8', 'M3.5 10v4', 'M17.5 8v8', 'M20.5 10v4', 'M6.5 12h11'],
  /** Bathroom scale with a half-round dial and its needle. */
  weight: [
    'M7.5 4h9A3.5 3.5 0 0 1 20 7.5v9a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 16.5v-9A3.5 3.5 0 0 1 7.5 4Z',
    'M8 11a4 4 0 0 1 8 0Z',
    'M12 11l1.5-2.2',
  ],
  /** Measuring tape / ruler with three ticks. */
  measure: [
    'M4.5 8h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5v-5A1.5 1.5 0 0 1 4.5 8Z',
    'M8 8v3',
    'M12 8v4.5',
    'M16 8v3',
  ],
  /** Page with a folded corner and two lines of text. */
  notes: [
    'M7 3.5h7l4.5 4.5v10.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z',
    'M14 3.5V8h4.5',
    'M8.5 12.5h7',
    'M8.5 16h5',
  ],

  // Settings rows
  bell: ['M6.4 16.4v-5.1a5.6 5.6 0 0 1 11.2 0v5.1l1.6 2.1H4.8Z', 'M10 21a2.2 2.2 0 0 0 4 0'],
  /** Two rings and a centre dot. */
  target: [
    'M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
    'M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z',
    'M12 12h.01',
  ],
  /** Crescent moon. */
  theme: ['M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z'],
  /** Cloud (backup and sync). */
  data: ['M7 18.5h10a3.75 3.75 0 0 0 0-7.5 5 5 0 0 0-10 0 3.75 3.75 0 0 0 0 7.5Z'],
  /** Door frame and an arrow leaving through it. */
  logout: ['M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7', 'M10.5 12H20', 'M16.5 8.5 20 12l-3.5 3.5'],

  // Accounts («Акаунт», «Користувачі», one-time links)
  /** Head and shoulders. */
  user: ['M15.8 8a3.8 3.8 0 1 1-7.6 0 3.8 3.8 0 0 1 7.6 0Z', 'M4.8 20a7.2 7.2 0 0 1 14.4 0'],
  /** Two people: one in front, the other half behind it on the right. */
  users: [
    'M12.7 8.5a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0Z',
    'M3.5 19.5a6 6 0 0 1 12 0',
    'M15.4 5.4a3.1 3.1 0 0 1 0 6.2',
    'M17.6 13.9a5.6 5.6 0 0 1 3.2 5.6',
  ],
  /** Two chain halves joined by a bar. */
  link: ['M9.6 8.2H7.4a3.8 3.8 0 0 0 0 7.6h2.2', 'M14.4 8.2h2.2a3.8 3.8 0 0 1 0 7.6h-2.2', 'M8.6 12h6.8'],
  /** Round bow at the lower left, a shaft to the upper right with two teeth. */
  key: [
    'M12 16a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    'M10.9 13.1 19.5 4.5',
    'M16.5 7.5l2.5 2.5',
    'M14.2 9.8l1.8 1.8',
  ],

  // Navigation
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronLeft: ['M14.5 6l-6 6 6 6'],

  // Workouts and steps
  /** Two footprints (sole + heel each), one step ahead of the other. */
  steps: [
    'M8.5 4a2.6 4.4 0 0 1 2.6 4.4 2.6 4.4 0 0 1-2.6 4.4 2.6 4.4 0 0 1-2.6-4.4A2.6 4.4 0 0 1 8.5 4Z',
    'M7 15.2a1.5 1.5 0 0 0 3 0',
    'M15.5 6.8a2.6 4.4 0 0 1 2.6 4.4 2.6 4.4 0 0 1-2.6 4.4 2.6 4.4 0 0 1-2.6-4.4A2.6 4.4 0 0 1 15.5 6.8Z',
    'M14 18a1.5 1.5 0 0 0 3 0',
  ],
  /** Start: a rounded triangle pointing right. */
  play: ['M8 5.5v13l10.5-6.5Z'],
  /** Stopwatch: dial, crown and one hand. */
  timer: ['M19 13.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'M10 3.5h4', 'M12 3.5v3', 'M12 13.5V10'],
  /** Magnifier. */
  search: ['M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', 'M15 15l5 5'],
  plus: ['M12 5v14', 'M5 12h14'],
  /** Drag handle: two columns of three dots. */
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14', 'M6 13l6 6 6-6'],
  /** Three dots in a row (a menu). */
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  /** Two overlapping rounded squares. */
  copy: [
    'M10.5 9h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5v-8A1.5 1.5 0 0 1 10.5 9Z',
    'M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9',
  ],
  /** Bin with a lid, its handle and two ribs. */
  trash: [
    'M4.5 7h15',
    'M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
    'M6.5 7l.9 11.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7',
    'M10 11v5',
    'M14 11v5',
  ],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  /** Cup with two handles on a stem and a base. */
  trophy: [
    'M7.5 4.5h9v5a4.5 4.5 0 0 1-9 0Z',
    'M7.5 6H4.5v1.5a3 3 0 0 0 3 3',
    'M16.5 6h3v1.5a3 3 0 0 1-3 3',
    'M12 14v5',
    'M8.5 19.5h7',
  ],
  /** A flame with an inner lick (burned kcal). */
  flame: [
    'M12 3.5c.5 3-3.5 4.8-3.5 8.8A5.5 5.5 0 0 0 12 20.5a5.5 5.5 0 0 0 5.5-5.6c0-2.6-1.6-4.2-2.6-5.4-.3 1.5-1 2.4-2 2.9.5-2.8-.2-5.9-.9-8.9Z',
  ],
};

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
  | 'chevronRight'
  | 'chevronLeft';

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

  // Navigation
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronLeft: ['M14.5 6l-6 6 6 6'],
};

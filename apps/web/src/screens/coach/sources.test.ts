/**
 * Source rules of «Клієнти» (docs/coach-cabinet.md §5.4, C8): the coach pages never touch the client app's own data
 * store — no `@/store/` import, no `useAppData`, `dataActions`, `ui.openSheet` or `setTrainedMark` — and never
 * persist anything (no IndexedDB, local / session storage or zustand store).
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./coach.fixtures.ts', '!./coach.testing.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(sources);

describe('screens/coach sources', () => {
  it('are all checked', () => {
    const names = files.map(([path]) => path);
    expect(names).toEqual(
      expect.arrayContaining(['./ClientsScreen.tsx', './ClientScreen.tsx', './useCoachData.ts', './nav.ts', './index.tsx']),
    );
  });

  it.each(files)('%s imports nothing from the app store', (_path, source) => {
    expect(source).not.toMatch(/from\s+['"]@\/store\//);
    expect(source).not.toMatch(/import\(\s*['"]@\/store\//);
    expect(source).not.toMatch(/from\s+['"](\.\.\/)+store\//);
  });

  it.each(files)('%s never reads or writes the client app’s data', (_path, source) => {
    for (const name of ['useAppData', 'dataActions', 'openSheet', 'setTrainedMark', 'useCalendarModel'])
      expect(source).not.toContain(name);
  });

  it.each(files)('%s keeps coach data in memory only', (_path, source) => {
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'idb-keyval', 'zustand'])
      expect(source).not.toContain(name);
  });
});

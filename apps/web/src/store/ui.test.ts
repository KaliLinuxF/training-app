import { afterEach, describe, expect, it } from 'vitest';
import { ui, useUiStore } from './ui';

const sheet = () => useUiStore.getState().sheet;

afterEach(() => ui.closeSheet());

describe('ui sheets', () => {
  it('openSheet starts a fresh draft every time (new key)', () => {
    ui.openSheet('2026-10-14', 'meal');
    const first = sheet()?.key;
    ui.openSheet('2026-10-14', 'meal');
    expect(sheet()).toMatchObject({ mode: 'meal', date: '2026-10-14' });
    expect(sheet()?.key).not.toBe(first);
  });

  it('moveSheet changes only the date: mode, key and patch stay (the draft moves with her)', () => {
    ui.openSheet('2026-10-14', 'day', { trained: true });
    const before = sheet();
    ui.moveSheet('2026-10-13');
    expect(sheet()).toEqual({ ...before, date: '2026-10-13' });
  });

  it('moveSheet to the same date changes nothing', () => {
    ui.openSheet('2026-10-14', 'meal');
    const before = sheet();
    ui.moveSheet('2026-10-14');
    expect(sheet()).toBe(before);
  });

  it('moveSheet without an open sheet is a no-op', () => {
    ui.closeSheet();
    ui.moveSheet('2026-10-13');
    expect(sheet()).toBeNull();
  });
});

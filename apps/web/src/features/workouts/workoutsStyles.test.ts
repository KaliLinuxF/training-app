import { describe, expect, it } from 'vitest';
import { cssRules, cssValue, px, readCss } from '@/ui/internal/cssSource';

/** Style contracts jsdom cannot render (docs/workouts-steps-rebrand.md §3.6, §3.9, §3.10, §3.19). */
const FILES = [
  'BuilderItemCard',
  'CardMenu',
  'PageHeader',
  'RestTimer',
  'SessionExerciseCard',
  'SessionScreen',
  'WorkoutBuilderScreen',
  'WorkoutsScreen',
].map((name) => [name, readCss(`features/workouts/${name}.module.css`)] as const);
const css = Object.fromEntries(FILES) as Record<string, string>;

describe('workouts styles', () => {
  it.each(FILES)('%s: colours come from tokens only (light + dark follow)', (_name, source) => {
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/i);
  });

  it('tap targets are at least 44px: set ✓, set rows, rest buttons, menu, grip, back link', () => {
    const card = css.SessionExerciseCard!;
    expect(px(cssValue(card, '.check', 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(card, '.check', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(card, '.value', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.RestTimer!, '.action', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.RestTimer!, '.action', 'min-width'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.CardMenu!, '.trigger', 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.CardMenu!, '.item', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.BuilderItemCard!, '.grip', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.PageHeader!, '.back', 'min-height'))).toBeGreaterThanOrEqual(44);
  });

  it('the workout name input is 16px (no iOS zoom) and at least 44px tall, with the field focus ring', () => {
    const b = css.WorkoutBuilderScreen!;
    expect(px(cssValue(b, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(b, '.input', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(cssValue(b, '.input:focus', 'box-shadow')).toBe('0 0 0 1px var(--focus)');
  });

  it('only the drag handle swallows touch scrolling', () => {
    expect(cssValue(css.BuilderItemCard!, '.grip', 'touch-action')).toBe('none');
    expect(cssValue(css.BuilderItemCard!, '.card', 'touch-action')).toBeUndefined();
  });

  it('sticky footers at the bottom (no tab bar on these pages), with the safe area', () => {
    for (const name of ['SessionScreen', 'WorkoutBuilderScreen']) {
      expect(cssValue(css[name]!, '.footer', 'position'), name).toBe('sticky');
      expect(cssValue(css[name]!, '.footer', 'bottom'), name).toBe('0');
      expect(cssValue(css[name]!, '.footer', 'padding'), name).toContain('var(--safe-bottom)');
    }
  });

  it('the rest bar turns mint when over; timers use tabular figures', () => {
    expect(cssValue(css.RestTimer!, '.over', 'background')).toBe('var(--acc2T)');
    expect(cssValue(css.RestTimer!, '.time', 'font-variant-numeric')).toBe('tabular-nums');
    expect(cssValue(css.SessionScreen!, '.timer', 'font-variant-numeric')).toBe('tabular-nums');
  });

  it('no transitions under reduced motion', () => {
    for (const name of ['BuilderItemCard', 'PageHeader', 'RestTimer', 'SessionExerciseCard']) {
      const reduced = cssRules(css[name]!).filter((r) => r.media?.includes('prefers-reduced-motion: reduce'));
      expect(reduced.length, name).toBeGreaterThan(0);
      expect(
        reduced.some((r) => r.decls.transition === 'none'),
        name,
      ).toBe(true);
    }
  });

  it('focus stays visible on our own controls', () => {
    expect(cssValue(css.SessionExerciseCard!, 'button.check:focus-visible', 'outline')).toBe(
      '2px solid var(--focus)',
    );
    expect(cssValue(css.SessionExerciseCard!, 'button.value:focus-visible', 'outline')).toBe(
      '2px solid var(--focus)',
    );
    expect(cssValue(css.CardMenu!, '.trigger:focus-visible', 'outline')).toBe('2px solid var(--focus)');
    expect(cssValue(css.RestTimer!, '.action:focus-visible', 'outline')).toBe('2px solid var(--focus)');
    expect(cssValue(css.PageHeader!, '.back:focus-visible', 'outline')).toBe('2px solid var(--focus)');
  });
});

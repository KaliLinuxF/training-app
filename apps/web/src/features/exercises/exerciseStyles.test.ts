import { describe, expect, it } from 'vitest';
import { cssRules, cssValue, px, readCss } from '@/ui/internal/cssSource';

/** Style contracts jsdom cannot render (docs/workouts-steps-rebrand.md §2, §3.19). */
const FILES = [
  'BodyMap',
  'MuscleChips',
  'ExerciseRow',
  'LibraryControls',
  'ExerciseEditorSheet',
  'ExercisePickerSheet',
  'ExerciseLibraryScreen',
  'ExerciseDetailScreen',
].map((name) => [name, readCss(`features/exercises/${name}.module.css`)] as const);
const css = Object.fromEntries(FILES) as Record<string, string>;

describe('exercises styles', () => {
  it.each(FILES)('%s: colours come from tokens only (light + dark follow)', (_name, source) => {
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/i);
  });

  it('body map paint: silhouette --line2 / --line3, idle --line, secondary --accLine, primary --acc, stroke --card', () => {
    const map = css.BodyMap!;
    expect(cssValue(map, '.silhouette', 'fill')).toBe('var(--line2)');
    expect(cssValue(map, '.silhouette', 'stroke')).toBe('var(--line3)');
    expect(cssValue(map, '.region', 'fill')).toBe('var(--line)');
    expect(cssValue(map, '.region', 'stroke')).toBe('var(--card)');
    expect(cssValue(map, '.secondary', 'fill')).toBe('var(--accLine)');
    expect(cssValue(map, '.primary', 'fill')).toBe('var(--acc)');
    expect(cssValue(map, '.region', 'transition')).toBe('fill 150ms ease');
    expect(px(cssValue(map, '.thumb', 'width'))).toBe(44);
    expect(px(cssValue(map, '.md', 'height'))).toBe(160);
    expect(px(cssValue(map, '.lg', 'height'))).toBe(240);
  });

  it('no transitions under reduced motion', () => {
    for (const name of ['BodyMap', 'MuscleChips', 'ExerciseRow']) {
      const reduced = cssRules(css[name]!).filter((r) => r.media?.includes('prefers-reduced-motion: reduce'));
      expect(reduced.length, name).toBeGreaterThan(0);
      expect(reduced.some((r) => r.decls.transition === 'none'), name).toBe(true);
    }
  });

  it('inputs are 16px (no iOS zoom) and at least 44px tall; rows at least 60px', () => {
    expect(px(cssValue(css.LibraryControls!, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(css.LibraryControls!, '.input', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.ExerciseEditorSheet!, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(css.ExerciseEditorSheet!, '.input', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css.ExerciseRow!, '.action', 'min-height'))).toBe(60);
  });

  it('the group chips are one line that scrolls sideways on the phone', () => {
    const c = css.LibraryControls!;
    expect(cssValue(c, '.chips', 'flex-wrap')).toBe('nowrap');
    expect(cssValue(c, '.chip', 'flex')).toBe('none');
    expect(cssValue(c, '.scroll', 'overflow-x')).toBe('auto');
    expect(cssValue(c, '.scroll', 'scrollbar-width')).toBe('none');
  });

  it('focus stays visible: an inset ring on rows, the field ring on inputs', () => {
    expect(cssValue(css.ExerciseRow!, '.action:focus-visible', 'outline')).toBe('2px solid var(--focus)');
    expect(cssValue(css.LibraryControls!, '.input:focus', 'box-shadow')).toBe('0 0 0 1px var(--focus)');
    expect(cssValue(css.ExerciseEditorSheet!, '.input:focus', 'box-shadow')).toBe('0 0 0 1px var(--focus)');
  });
});

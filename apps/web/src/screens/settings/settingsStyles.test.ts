import { describe, expect, it } from 'vitest';
import { contrast, cssValue, readCss, themeTokens, tokenName, type Theme } from '@/ui/internal/cssSource';

/**
 * Style contracts of «Налаштування» that jsdom cannot render. (The e2e suite checks the real layout:
 * e2e/settings.spec.ts; the screenshots: e2e/visual.spec.ts 40–46.)
 */

const THEMES: Theme[] = ['light', 'dark'];
const list = readCss('screens/settings/SettingsList.module.css');
const pill = readCss('ui/feedback/Pill.module.css');
const listRow = readCss('ui/lists/ListRow.module.css');

/** WCAG ratio of two token references («var(--accD)») in a theme. */
function tokenContrast(theme: Theme, fg: string | undefined, bg: string | undefined): number {
  const t = themeTokens(theme);
  const [a, b] = [t[tokenName(fg)], t[tokenName(bg)]];
  if (a === undefined || b === undefined) throw new Error(`unknown token in ${fg} / ${bg}`);
  return contrast(a, b);
}

describe('the push badge on the selected «Нагадування» row (desktop)', () => {
  const selectedRow = cssValue(listRow, '.action[aria-current]', 'background');
  const lifted = cssValue(list, '.nav [aria-current] .badge', 'background');

  it('the selected row and the acc pill share --accT, so the pill needs lifting there', () => {
    expect(selectedRow).toBe('var(--accT)');
    expect(cssValue(pill, '.acc', 'background')).toBe('var(--accT)');
  });

  it('is lifted onto the card colour, with a selector that outranks the pill’s one-class tone', () => {
    expect(lifted).toBe('var(--card)');
  });

  it.each(THEMES)('stands out as a chip on the tinted row (%s)', (theme) => {
    expect(tokenContrast(theme, lifted, selectedRow)).toBeGreaterThan(1.1);
  });

  it.each(THEMES)('keeps its text readable on the card colour: acc and neutral tones (%s)', (theme) => {
    for (const tone of ['.acc', '.neutral']) {
      expect(tokenContrast(theme, cssValue(pill, tone, 'color'), lifted), tone).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('«Акаунт» and «Користувачі»', () => {
  const forms = readCss('screens/settings/forms.module.css');
  const sheet = readCss('screens/settings/users/UserSheet.module.css');
  const link = readCss('screens/settings/users/LinkCard.module.css');
  const account = readCss('screens/settings/account/AccountPage.module.css');
  const users = readCss('screens/settings/users/UsersPage.module.css');
  const px = (value: string | undefined) => parseFloat(value ?? 'NaN');

  it('keeps every field at 16px text (iOS zooms into less) and 54px tall, with the kit’s focus ring', () => {
    expect(px(cssValue(forms, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(forms, '.input', 'height'))).toBe(54);
    expect(px(cssValue(link, '.url', 'font-size'))).toBe(16);
    expect(cssValue(forms, '.input:focus', 'border-color')).toBe('var(--focus)');
    expect(cssValue(forms, '.input:focus', 'box-shadow')).toBe('0 0 0 1px var(--focus)');
    // On a sheet's --paper the field takes the card colour, so it does not vanish into the page.
    expect(cssValue(forms, '.input', 'background')).toBe('var(--paper)');
    expect(cssValue(forms, '.input.onPaper', 'background')).toBe('var(--card)');
  });

  it('a focused field has one ring: its border, not the global :focus-visible outline as well', () => {
    expect(cssValue(readCss('styles/global.css'), ':focus-visible', 'outline')).toBe(
      '2px solid var(--focus)',
    );
    expect(cssValue(forms, '.input:focus-visible', 'outline')).toBe('none');
  });

  it('gives the text buttons and rows 44px targets', () => {
    expect(px(cssValue(sheet, 'button.deleteOpen', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(sheet, '.switchRow', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(account, '.viewRow', 'min-height'))).toBeGreaterThanOrEqual(44);
  });

  it('rounds the ghost buttons the focus comes back to, so their ring is not a sharp box', () => {
    // The kit's ghost Button has no radius of its own.
    const button = readCss('ui/controls/Button.module.css');
    expect(cssValue(button, '.ghost', 'border-radius')).toBeUndefined();
    expect(cssValue(sheet, 'button.deleteOpen', 'border-radius')).toBe('var(--r12)');
    expect(cssValue(users, 'button.revoke', 'border-radius')).toBe('var(--r12)');
    expect(cssValue(account, 'button.edit', 'border-radius')).toBe('var(--r12)');
  });

  it('greys a disabled «Видалити назавжди» like the kit’s other disabled solids, the accent only when enabled', () => {
    const button = readCss('ui/controls/Button.module.css');
    expect(cssValue(forms, 'button.danger:disabled', 'background')).toBe(
      cssValue(button, '.solid', 'background'),
    );
    expect(cssValue(forms, 'button.danger:disabled', 'color')).toBe(cssValue(button, '.solid', 'color'));
    expect(cssValue(forms, 'button.danger', 'background')).toBe('var(--accD)');
  });

  it('shows no ring on the headings the focus is put on after an action (like LinkCard’s title)', () => {
    for (const selector of ['.focusSpot:focus', '.focusSpot h2:focus', '.focusSpot h3:focus']) {
      expect(cssValue(forms, selector, 'outline'), selector).toBe('none');
    }
    expect(cssValue(link, '.title:focus', 'outline')).toBe('none');
  });

  it.each(THEMES)(
    'makes «Запрошення · N» / «Акаунти · N» list captions in the desktop pane, readable on the paper (%s)',
    (theme) => {
      const captions = readCss('ui/lists/ListGroup.module.css');
      for (const prop of ['font-size', 'font-weight', 'color', 'padding']) {
        expect(cssValue(users, 'h3.paneGroupTitle', prop), prop).toBe(cssValue(captions, '.caption', prop));
      }
      expect(
        tokenContrast(theme, cssValue(users, 'h3.paneGroupTitle', 'color'), 'var(--paper)'),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('outranks the kit Button’s one-class variants with element + class selectors', () => {
    expect(cssValue(forms, 'button.danger', 'background')).toBe('var(--accD)');
    expect(cssValue(forms, 'button.dangerGhost', 'color')).toBe('var(--accD)');
    expect(cssValue(users, 'button.revoke', 'color')).toBe('var(--accD)');
    expect(cssValue(link, 'section.card', 'border-color')).toBe('var(--accLine)');
  });

  it.each(THEMES)('keeps the copy readable on cards and on the sheet’s paper (%s)', (theme) => {
    for (const bg of ['var(--card)', 'var(--paper)']) {
      for (const [file, selector] of [
        [forms, '.note'],
        [forms, '.hint'],
        [forms, '.status'],
        [forms, '.label'],
        [sheet, '.fact'],
        [sheet, '.switchSub'],
        [sheet, '.label'],
        [sheet, '.deleteBody'],
        [account, '.since'],
        [account, '.provenance'],
      ] as const) {
        expect(
          tokenContrast(theme, cssValue(file, selector, 'color'), bg),
          `${selector} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(
      tokenContrast(theme, cssValue(forms, '.error', 'color'), cssValue(forms, '.error', 'background')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      tokenContrast(
        theme,
        cssValue(forms, 'button.danger', 'color'),
        cssValue(forms, 'button.danger', 'background'),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['var(--card)', 'var(--paper)']) {
      expect(tokenContrast(theme, cssValue(forms, 'button.dangerGhost', 'color'), bg)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(
      tokenContrast(theme, cssValue(link, '.icon', 'color'), cssValue(link, '.icon', 'background')),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('«Прийоми їжі» and «Б · Ж · В на день»', () => {
  const meals = readCss('screens/settings/MealTypesCard.module.css');
  const macros = readCss('screens/settings/MacroGoalsCard.module.css');
  const px = (value: string | undefined) => parseFloat(value ?? 'NaN');

  it('keeps every text field at 16px (iOS zooms into anything smaller) and at least 44px tall', () => {
    expect(px(cssValue(meals, '.name', 'font-size'))).toBe(16);
    expect(px(cssValue(meals, '.name', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(meals, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(meals, '.input', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(macros, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(macros, '.input', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(macros, '.input', 'width'))).toBe(96);
  });

  it('gives the view rows 44px and the edit row three 44px buttons next to a field that may shrink', () => {
    expect(px(cssValue(meals, '.row', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(cssValue(meals, '.editRow', 'grid-template-columns')).toBe('minmax(0, 1fr) repeat(3, 44px)');
    expect(cssValue(meals, '.name', 'min-width')).toBe('0');
  });

  it('dims an aria-disabled ↑ / ↓ like a disabled glyph button', () => {
    expect(cssValue(meals, ".control[aria-disabled='true']", 'color')).toBe('var(--faint)');
    expect(cssValue(meals, ".list .control[aria-disabled='true']:active", 'transform')).toBe('none');
  });

  it.each(THEMES)('keeps the notes and errors readable on their surfaces (%s)', (theme) => {
    expect(tokenContrast(theme, cssValue(meals, '.note', 'color'), 'var(--paper)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(macros, '.note', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(meals, '.error', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(macros, '.error', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

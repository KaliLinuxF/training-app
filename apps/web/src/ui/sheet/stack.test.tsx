import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from '../feedback/ConfirmDialog';
import { cssRules, cssValue, readCss, themeTokens } from '../internal/cssSource';
import { installMatchMedia, stubScrollTo } from '../internal/testing';
import { trapTabKey } from './focus';
import { Sheet, SHEET_EXIT_MS } from './Sheet';
import s from './Sheet.module.css';
import { SHEET_Z_MAX, sheetZIndex } from './stack';

/**
 * Two stacked sheets, as in the day sheet → «one food position» editor: the editor is rendered inside
 * the day sheet's content and opened by tapping a row.
 */
function DayWithEditor({
  dayOpen = true,
  onDayClose = () => undefined,
  onEditorExited,
  initialEditing = null,
  guarded = false,
  autoFocusName = false,
}: {
  dayOpen?: boolean;
  onDayClose?: () => void;
  onEditorExited?: () => void;
  initialEditing?: string | null;
  /** Ask «Є незбережені зміни» before the editor closes (like the app's sheet guard). */
  guarded?: boolean;
  /** The editor puts her in its name field itself (a new row). */
  autoFocusName?: boolean;
}) {
  const [items, setItems] = useState(['Вівсянка', 'Кава з молоком']);
  const [editing, setEditing] = useState<string | null>(initialEditing);
  const closeEditor = () => {
    if (!guarded) {
      setEditing(null);
      return;
    }
    const ask = ui.confirm({ title: 'Є незбережені зміни', confirmLabel: 'Закрити' });
    void ask.then((ok) => ok && setEditing(null));
  };
  const remove = () => {
    setItems((list) => list.filter((name) => name !== editing));
    setEditing(null);
  };
  return (
    <Sheet
      open={dayOpen}
      onClose={onDayClose}
      heading="Запис дня"
      footer={<button type="button">Зберегти</button>}
    >
      {items.map((name) => (
        <button key={name} type="button" onClick={() => setEditing(name)}>
          {name}
        </button>
      ))}
      <Sheet
        open={editing !== null}
        onClose={closeEditor}
        heading="Позиція"
        size="compact"
        onExited={onEditorExited}
        footer={
          <button type="button" onClick={remove}>
            Видалити позицію
          </button>
        }
      >
        <input key={editing} aria-label="Назва" autoFocus={autoFocusName} />
      </Sheet>
    </Sheet>
  );
}

/** «+ позиція» → «Додати позицію»: the caller moves focus to the new row itself (in a layout effect). */
function DayWithNewRowFocus({ onFocused }: { onFocused: (dayWasInert: boolean) => void }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  const newRow = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const row = newRow.current;
    if (!added || !row) return;
    onFocused(row.closest('[role="dialog"]')?.parentElement?.hasAttribute('inert') ?? true);
    row.focus();
  }, [added, onFocused]);
  return (
    <Sheet open onClose={() => undefined} heading="Запис дня">
      <button type="button" onClick={() => setAdding(true)}>
        + позиція
      </button>
      <button ref={newRow} type="button">
        Новий рядок
      </button>
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        heading="Нова позиція"
        size="compact"
        footer={
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setAdded((n) => n + 1);
            }}
          >
            Додати позицію
          </button>
        }
      >
        <input aria-label="Назва" />
      </Sheet>
    </Sheet>
  );
}

const day = () => screen.getByRole('dialog', { name: 'Запис дня' });
const editor = () => screen.queryByRole('dialog', { name: 'Позиція' });
const backdropOf = (dialog: HTMLElement | null): HTMLElement => {
  const backdrop = dialog?.parentElement;
  if (!backdrop) throw new Error('dialog has no backdrop');
  return backdrop;
};
const zIndexOf = (dialog: HTMLElement | null) => Number(backdropOf(dialog).style.zIndex);
const isInert = (dialog: HTMLElement | null) => backdropOf(dialog).hasAttribute('inert');
const cls = (name: string): string => {
  const className = s[name];
  if (!className) throw new Error(`no .${name} in Sheet.module.css`);
  return className;
};

/** Focuses the row (as a tap does) and opens the editor from it. */
function openEditor(name = 'Вівсянка'): HTMLElement {
  const row = screen.getByRole('button', { name });
  row.focus();
  fireEvent.click(row);
  return row;
}

function pressEscape() {
  fireEvent.keyDown(document, { key: 'Escape' });
}

function finishExit() {
  act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
}

/**
 * A tap on the backdrop of `dialog`. While a sheet closes, its panel takes no presses (`.closing .panel`), so this is
 * also where the second tap of a double tap on one of its buttons lands. Returns `false` when the press was
 * swallowed whole (its mousedown default prevented: it does not move focus).
 */
function tapBackdrop(dialog: HTMLElement | null): boolean {
  const backdrop = backdropOf(dialog);
  fireEvent.pointerDown(backdrop);
  const focusMoves = fireEvent.mouseDown(backdrop);
  fireEvent.mouseUp(backdrop);
  fireEvent.click(backdrop);
  return focusMoves;
}

/** A finger dragging the sheet header 300px down (touch pointer events). */
function dragDown(dialog: HTMLElement) {
  const heading = within(dialog).getByRole('heading');
  const touch = { pointerType: 'touch', pointerId: 7 };
  fireEvent.pointerDown(heading, { ...touch, clientY: 100 });
  fireEvent.pointerMove(heading, { ...touch, clientY: 400 });
  fireEvent.pointerUp(heading, { ...touch, clientY: 400 });
}

let scrollTo: ReturnType<typeof stubScrollTo>;

beforeAll(() => {
  installMatchMedia();
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = () => undefined;
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
});
beforeEach(() => {
  vi.useFakeTimers();
  scrollTo = stubScrollTo();
});
afterEach(() => {
  cleanup();
  useUiStore.setState({ confirm: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('stacked sheets', () => {
  it('render the second sheet above the first and make the first inert', () => {
    render(<DayWithEditor />);
    expect(zIndexOf(day())).toBe(60);
    expect(isInert(day())).toBe(false);

    openEditor();
    expect(zIndexOf(editor())).toBe(62);
    expect(zIndexOf(editor())).toBeGreaterThan(zIndexOf(day()));
    expect(isInert(day())).toBe(true);
    expect(isInert(editor())).toBe(false);
    expect(backdropOf(editor()).classList.contains(cls('stacked'))).toBe(true);
    expect(backdropOf(editor()).classList.contains(cls('compact'))).toBe(true);
    expect(backdropOf(day()).classList.contains(cls('stacked'))).toBe(false);
    // Both are portalled into <body>, the editor after the day sheet.
    expect(backdropOf(editor()).parentElement).toBe(document.body);
    expect(backdropOf(day()).nextElementSibling).toBe(backdropOf(editor()));
  });

  it('keep every sheet below the photo viewer (70), the toast (80) and ui.confirm() (90)', () => {
    expect([0, 1, 2, 3].map(sheetZIndex)).toEqual([60, 62, 64, 66]);
    expect(sheetZIndex(10)).toBe(SHEET_Z_MAX);
    expect(SHEET_Z_MAX).toBeLessThan(70);
  });

  it('Escape closes only the top sheet; the sheet below is live again while the top animates out', () => {
    const onDayClose = vi.fn();
    const onEditorExited = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} onEditorExited={onEditorExited} />);
    openEditor();

    pressEscape();
    expect(onDayClose).not.toHaveBeenCalled();
    // Retained for the exit animation, no longer covering the day sheet.
    expect(editor()).not.toBeNull();
    expect(backdropOf(editor()).classList.contains(cls('closing'))).toBe(true);
    expect(backdropOf(day()).classList.contains(cls('closing'))).toBe(false);
    expect(zIndexOf(editor())).toBe(62); // still drawn above while it slides out
    expect(isInert(day())).toBe(false);
    expect(isInert(editor())).toBe(false);

    finishExit();
    expect(editor()).toBeNull();
    expect(onEditorExited).toHaveBeenCalledOnce();
    expect(day()).toBeTruthy();
    expect(onDayClose).not.toHaveBeenCalled();

    pressEscape();
    expect(onDayClose).toHaveBeenCalledOnce();
  });

  it('a second Escape during the exit of the top closes the sheet below (it is the top again)', () => {
    const onDayClose = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} />);
    openEditor();
    pressEscape();
    pressEscape();
    expect(onDayClose).toHaveBeenCalledOnce();
  });

  it('ignore backdrop presses on the covered sheet; the top backdrop closes only the top', () => {
    const onDayClose = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} />);
    openEditor();

    const dayBackdrop = backdropOf(day());
    fireEvent.pointerDown(dayBackdrop);
    fireEvent.click(dayBackdrop);
    expect(onDayClose).not.toHaveBeenCalled();
    expect(isInert(day())).toBe(true);

    // The press bubbles (React portals) through the day sheet too, which must not take it as its own.
    const editorBackdrop = backdropOf(editor());
    fireEvent.pointerDown(editorBackdrop);
    fireEvent.click(editorBackdrop);
    expect(onDayClose).not.toHaveBeenCalled();
    expect(isInert(day())).toBe(false);
    finishExit();
    expect(editor()).toBeNull();
  });

  it('ignore drag-down on the covered sheet; dragging the top sheet dismisses only it', () => {
    const onDayClose = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} />);
    openEditor();

    dragDown(day());
    expect(onDayClose).not.toHaveBeenCalled();
    expect(day().style.transform).toBe('');

    dragDown(editor() as HTMLElement);
    expect(onDayClose).not.toHaveBeenCalled();
    expect(isInert(day())).toBe(false);
    finishExit();
    expect(editor()).toBeNull();

    // Live again: the day sheet can be dragged away now.
    dragDown(day());
    expect(onDayClose).toHaveBeenCalledOnce();
  });

  it('move focus into the top sheet and back to its opener in the sheet below as soon as it closes', () => {
    render(<DayWithEditor />);
    const row = openEditor();
    expect(document.activeElement).toBe(editor());

    fireEvent.click(within(editor() as HTMLElement).getByRole('button', { name: 'Закрити' }));
    expect(document.activeElement).toBe(row);

    // She moves on in the day sheet during the exit: unmounting the editor must not pull focus back.
    const save = screen.getByRole('button', { name: 'Зберегти' });
    save.focus();
    finishExit();
    expect(document.activeElement).toBe(save);
  });

  it('give focus to the sheet below when the opener is gone (its row was deleted)', () => {
    render(<DayWithEditor />);
    openEditor('Кава з молоком');
    const remove = screen.getByRole('button', { name: 'Видалити позицію' });
    remove.focus();
    fireEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Кава з молоком' })).toBeNull();
    expect(document.activeElement).toBe(day());
    finishExit();
    expect(document.activeElement).toBe(day());
  });

  it('leave focus where the content put it on open (autoFocus) and still return it to the row', () => {
    render(<DayWithEditor autoFocusName />);
    const row = openEditor();
    const name = within(editor() as HTMLElement).getByRole('textbox', { name: 'Назва' });
    expect(document.activeElement).toBe(name);

    pressEscape();
    expect(document.activeElement).toBe(row);

    // Reopened from another row during the exit: her new field again, and back to that row afterwards.
    const other = openEditor('Кава з молоком');
    expect(document.activeElement).toBe(
      within(editor() as HTMLElement).getByRole('textbox', { name: 'Назва' }),
    );
    finishExit();
    pressEscape();
    expect(document.activeElement).toBe(other);
  });

  it('let the caller move focus into the sheet below while the top closes (it is live by then)', () => {
    const onFocused = vi.fn();
    render(<DayWithNewRowFocus onFocused={onFocused} />);
    openEditor('+ позиція');
    const add = screen.getByRole('button', { name: 'Додати позицію' });
    add.focus();
    fireEvent.click(add);
    expect(onFocused).toHaveBeenCalledExactlyOnceWith(false);
    const newRow = screen.getByRole('button', { name: 'Новий рядок' });
    expect(document.activeElement).toBe(newRow);
    finishExit();
    expect(document.activeElement).toBe(newRow);
  });

  it('trap Tab inside the top sheet', () => {
    render(<DayWithEditor />);
    openEditor();
    const top = editor() as HTMLElement;
    const close = within(top).getByRole('button', { name: 'Закрити' });
    const remove = within(top).getByRole('button', { name: 'Видалити позицію' });

    remove.focus();
    fireEvent.keyDown(remove, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(remove);

    top.focus();
    fireEvent.keyDown(top, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(remove);
  });

  it('share one scroll lock: closing the top keeps the page locked, closing the last restores it once', () => {
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(320);
    const { rerender } = render(<DayWithEditor />);
    const html = document.documentElement;
    expect(html.classList.contains('scroll-locked')).toBe(true);
    expect(document.body.style.top).toBe('-320px');

    openEditor();
    scrollY.mockReturnValue(0); // the pinned body reports no scroll; the saved offset must survive
    pressEscape();
    finishExit();
    expect(editor()).toBeNull();
    expect(html.classList.contains('scroll-locked')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-320px');
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<DayWithEditor dayOpen={false} />);
    finishExit();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(html.classList.contains('scroll-locked')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith(0, 320);
  });

  it('reopening the top sheet during its exit covers the sheet below and takes focus again', () => {
    render(<DayWithEditor />);
    openEditor();
    pressEscape();
    expect(isInert(day())).toBe(false);

    const other = openEditor('Кава з молоком');
    expect(isInert(day())).toBe(true);
    expect(document.activeElement).toBe(editor());
    finishExit();
    expect(editor()).not.toBeNull();

    pressEscape();
    expect(document.activeElement).toBe(other);
  });

  it('closing both at once leaves no inert sheet and gives focus back to the page', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(<DayWithEditor />);
    openEditor();

    rerender(<DayWithEditor dayOpen={false} />);
    finishExit();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('a sheet mounted together with the sheet it is rendered in still stacks above it and gets focus', () => {
    const onDayClose = vi.fn();
    render(<DayWithEditor initialEditing="Вівсянка" onDayClose={onDayClose} />);
    expect(zIndexOf(editor())).toBe(62);
    expect(isInert(day())).toBe(true);
    expect(document.activeElement).toBe(editor());

    pressEscape();
    expect(onDayClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(day());
  });

  it('sibling sheets stack in the order they open', () => {
    const { rerender } = render(
      <>
        <Sheet open onClose={() => undefined} heading="Перший" />
        <Sheet open={false} onClose={() => undefined} heading="Другий" />
      </>,
    );
    rerender(
      <>
        <Sheet open onClose={() => undefined} heading="Перший" />
        <Sheet open onClose={() => undefined} heading="Другий" />
      </>,
    );
    const first = screen.getByRole('dialog', { name: 'Перший' });
    const second = screen.getByRole('dialog', { name: 'Другий' });
    expect(zIndexOf(second)).toBeGreaterThan(zIndexOf(first));
    expect(isInert(first)).toBe(true);
  });

  it('a double tap closes only the top sheet: its backdrop swallows the second tap until it has gone', () => {
    const onDayClose = vi.fn();
    const onEditorExited = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} onEditorExited={onEditorExited} />);
    const row = openEditor();

    // First tap: the editor starts closing, the day sheet under it is live again and focus is back on the row.
    fireEvent.click(within(editor() as HTMLElement).getByRole('button', { name: 'Закрити' }));
    expect(isInert(day())).toBe(false);
    expect(document.activeElement).toBe(row);

    // Second tap, 90ms later: the editor's backdrop is still there, drawn above the day sheet, and takes it.
    act(() => vi.advanceTimersByTime(90));
    expect(backdropOf(editor()).classList.contains(cls('closing'))).toBe(true);
    expect(zIndexOf(editor())).toBeGreaterThan(zIndexOf(day()));
    expect(tapBackdrop(editor())).toBe(false); // swallowed: the row keeps focus
    expect(document.activeElement).toBe(row);
    expect(onDayClose).not.toHaveBeenCalled();

    finishExit();
    expect(editor()).toBeNull();
    expect(onEditorExited).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('dialog')).toEqual([day()]);
    expect(onDayClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
  });

  it('«Видалити позицію» ×2: the second tap is swallowed too (one row deleted, focus stays on the day sheet)', () => {
    const onDayClose = vi.fn();
    render(<DayWithEditor onDayClose={onDayClose} />);
    openEditor('Вівсянка');
    fireEvent.click(screen.getByRole('button', { name: 'Видалити позицію' }));
    expect(document.activeElement).toBe(day()); // its row is gone
    expect(tapBackdrop(editor())).toBe(false);
    expect(document.activeElement).toBe(day());
    finishExit();
    expect(screen.queryByRole('button', { name: 'Вівсянка' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Кава з молоком' })).toBeTruthy();
    expect(editor()).toBeNull();
    expect(onDayClose).not.toHaveBeenCalled();
  });

  it('only a closing backdrop swallows presses; presses from a sheet over a closing one are left alone', () => {
    const { rerender } = render(<DayWithEditor initialEditing="Вівсянка" />);
    // A live backdrop is an ordinary backdrop: a press on it may move focus as usual (and closes the sheet).
    expect(fireEvent.mouseDown(backdropOf(editor()))).toBe(true);

    // The day sheet closes under the open editor: presses inside the editor bubble to the day sheet's backdrop
    // through the portal and must still focus her field.
    rerender(<DayWithEditor initialEditing="Вівсянка" dayOpen={false} />);
    expect(backdropOf(day()).classList.contains(cls('closing'))).toBe(true);
    const name = within(editor() as HTMLElement).getByRole('textbox', { name: 'Назва' });
    expect(fireEvent.mouseDown(name)).toBe(true);
    expect(fireEvent.mouseDown(backdropOf(editor()))).toBe(true);
  });

  it('a single sheet stays at the base z-index and is never inert', () => {
    render(<Sheet open onClose={() => undefined} heading="Вага" size="compact" />);
    const dialog = screen.getByRole('dialog', { name: 'Вага' });
    expect(zIndexOf(dialog)).toBe(60);
    expect(isInert(dialog)).toBe(false);
  });

  it('let ui.confirm() over the top sheet take Escape first, then hand focus back through both', async () => {
    const onDayClose = vi.fn();
    render(
      <>
        <DayWithEditor guarded onDayClose={onDayClose} />
        <ConfirmHost />
      </>,
    );
    const row = openEditor();

    pressEscape(); // the editor asks first
    const ask = screen.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    expect(ask.contains(document.activeElement)).toBe(true);
    pressEscape(); // answers «stay»: neither sheet closes
    await act(async () => undefined);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onDayClose).not.toHaveBeenCalled();
    expect(isInert(day())).toBe(true);
    expect(document.activeElement).toBe(editor());

    pressEscape();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Закрити' }));
    });
    expect(isInert(day())).toBe(false);
    expect(document.activeElement).toBe(row);
    finishExit();
    expect(editor()).toBeNull();
    expect(onDayClose).not.toHaveBeenCalled();
  });
});

describe('trapTabKey', () => {
  it('leaves alone Tab presses from a sheet stacked over this one (bubbled through the portal)', () => {
    const root = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(root, outside);
    const preventDefault = vi.fn();
    const event = { key: 'Tab', shiftKey: false, currentTarget: root, target: outside, preventDefault };
    trapTabKey(event as unknown as Parameters<typeof trapTabKey>[0]);
    expect(preventDefault).not.toHaveBeenCalled();

    // Its own Tab with nothing focusable inside stays put.
    trapTabKey({ ...event, target: root } as unknown as Parameters<typeof trapTabKey>[0]);
    expect(preventDefault).toHaveBeenCalledOnce();
    root.remove();
    outside.remove();
  });
});

describe('stacked and compact sizes (CSS contract)', () => {
  const css = readCss('ui/sheet/Sheet.module.css');
  /** Every selector (of every selector list) that sets `prop`. */
  const selectorsSetting = (prop: string) =>
    cssRules(css)
      .filter((rule) => rule.media === null && prop in rule.decls)
      .flatMap((rule) => rule.selector.split(',').map((sel) => sel.trim()));

  it('on phones a sheet over another one is a little shorter, so the sheet below peeks out above it', () => {
    expect(cssValue(css, '.panel', 'max-height')).toBe('92dvh');
    expect(cssValue(css, '.mobile.stacked .panel', 'max-height')).toBe('86dvh');
    expect(cssValue(css, '.mobile.compact .panel', 'max-height')).toBe('86dvh');
  });

  it('on desktop a sheet over another one is as tall as the sheet below may be: its footer covers the footer below', () => {
    const desktopMax = cssValue(css, '.desktop .panel', 'max-height');
    expect(desktopMax).toBe('min(720px, 92dvh)');
    // Nothing caps a desktop window that is stacked or compact lower than that (it was 600px: «Зберегти» showed
    // under «Готово» and the editor's kcal hid under its footer in an 800px window)…
    const lowerCaps = selectorsSetting('max-height').filter((sel) =>
      /\.desktop\.(stacked|compact)/.test(sel),
    );
    expect(lowerCaps).toEqual([]);
    // …and a stacked one is never shorter, whatever its content.
    expect(cssValue(css, '.desktop.stacked .panel', 'min-height')).toBe(desktopMax);
  });

  it('compact is a narrower (440px) centred window on desktop', () => {
    expect(cssValue(css, '.desktop .panel', 'max-width')).toBe('560px');
    expect(cssValue(css, '.desktop.compact .panel', 'max-width')).toBe('440px');
  });

  it('a stacked backdrop dims twice (two coats of --backdrop), so the sheet below and its solid buttons recede', () => {
    expect(cssValue(css, '.backdrop::before', 'background')).toBe('var(--backdrop)');
    expect(cssValue(css, '.stacked::before', 'background')).toBe(
      'linear-gradient(var(--backdrop), var(--backdrop)), var(--backdrop)',
    );
    for (const theme of ['light', 'dark'] as const) {
      const alpha = Number(/,\s*([\d.]+)\)$/.exec(themeTokens(theme).backdrop ?? '')?.[1]);
      expect(alpha).toBeGreaterThan(0);
      // Over the sheet below: ≈ 0.66 light, 0.80 dark (one coat: 0.42 / 0.55, too little for the dark-on-dark button).
      expect(1 - (1 - alpha) ** 2).toBeGreaterThan(0.65);
    }
  });

  it('a closing sheet keeps its backdrop as a tap shield until it unmounts; only its panel stops reacting', () => {
    // No rule turns pointer events off on the backdrop (`.backdrop`, `.closing`, `.stacked`, …): only on the panel.
    expect(selectorsSetting('pointer-events')).toEqual(['.closing .panel']);
    expect(cssValue(css, '.closing .panel', 'pointer-events')).toBe('none');
  });
});

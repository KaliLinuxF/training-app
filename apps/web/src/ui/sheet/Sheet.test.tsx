import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMatchMedia, stubScrollTo } from '../internal/testing';
import { Sheet, SHEET_EXIT_MS } from './Sheet';
import { useRetained } from './useRetained';

beforeAll(() => installMatchMedia());
beforeEach(() => {
  stubScrollTo();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const backdropOf = (dialog: HTMLElement): HTMLElement => {
  const backdrop = dialog.parentElement;
  if (!backdrop) throw new Error('dialog has no backdrop');
  return backdrop;
};

function renderSheet(onClose = vi.fn(), open = true) {
  const utils = render(
    <>
      <button type="button">opener</button>
      <Sheet
        open={open}
        onClose={onClose}
        heading="Запис дня"
        footer={<button type="button">Зберегти</button>}
      >
        <textarea aria-label="Що я їла" />
      </Sheet>
    </>,
  );
  return { ...utils, onClose };
}

describe('Sheet', () => {
  it('renders a labelled modal dialog into document.body', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Запис дня' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(backdropOf(dialog).parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a backdrop click but not on clicks inside the panel', () => {
    const { onClose } = renderSheet();
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    // A press that starts inside (e.g. selecting text) and ends on the backdrop must not close.
    fireEvent.pointerDown(screen.getByRole('textbox'));
    fireEvent.click(backdropOf(dialog));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdropOf(dialog));
    fireEvent.click(backdropOf(dialog));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with the ✕ button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog, locks page scroll, and restores both after the exit animation', () => {
    vi.useFakeTimers();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const onClose = vi.fn();
    const onExited = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={onClose} heading="Вага" onExited={onExited}>
        тіло
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(true);
    expect(document.body.style.position).toBe('fixed');

    rerender(
      <Sheet open={false} onClose={onClose} heading="Вага" onExited={onExited}>
        тіло
      </Sheet>,
    );
    // Still mounted while animating out; Escape is ignored now.
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onExited).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('swallows a second tap while animating out, so a double tap on «Зберегти» cannot reach the page', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const sheet = (open: boolean) => (
      <Sheet
        open={open}
        onClose={onClose}
        heading="Запис дня"
        footer={<button type="button">Зберегти</button>}
      >
        тіло
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    const save = screen.getByRole('button', { name: 'Зберегти' });
    save.focus();
    rerender(sheet(false)); // saved: the sheet animates out

    // The second tap lands on the backdrop, still covering the page until the sheet unmounts (the panel takes no
    // presses now, see the CSS contract in stack.test.tsx): it neither closes again nor moves focus.
    const backdrop = backdropOf(screen.getByRole('dialog'));
    expect(backdrop.parentElement).toBe(document.body);
    fireEvent.pointerDown(backdrop);
    expect(fireEvent.mouseDown(backdrop)).toBe(false);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(save);

    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the date navigator and disables «›» when the next day is not allowed', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <Sheet
        open
        onClose={() => undefined}
        heading="Запис дня"
        dateNav={{ date: '10 жовтня 2026', weekday: 'субота · сьогодні', onPrev, onNext, canNext: false }}
      />,
    );
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();
    expect(screen.getByText('субота · сьогодні')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders nothing while closed', () => {
    renderSheet(vi.fn(), false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useRetained', () => {
  it('keeps the last non-null value', () => {
    const { result, rerender } = renderHook(({ v }: { v: string | null }) => useRetained(v), {
      initialProps: { v: null as string | null },
    });
    expect(result.current).toBeNull();
    rerender({ v: 'day' });
    expect(result.current).toBe('day');
    rerender({ v: null });
    expect(result.current).toBe('day');
    rerender({ v: 'weight' });
    expect(result.current).toBe('weight');
  });
});

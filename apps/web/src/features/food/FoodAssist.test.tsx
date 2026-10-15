import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodAssist, type FoodAssistProps } from './FoodAssist';

afterEach(cleanup);

function setup(over: Partial<FoodAssistProps> = {}) {
  const handlers = {
    onCount: vi.fn(),
    onToggleComposer: vi.fn(),
    onComposerText: vi.fn(),
    onSubmitComposer: vi.fn(),
    onPhoto: vi.fn(),
  };
  const props = (more: Partial<FoodAssistProps> = {}): FoodAssistProps => ({
    mode: 'count',
    tail: '',
    busy: false,
    composerOpen: false,
    composerText: '',
    ...handlers,
    ...over,
    ...more,
  });
  const view = render(<FoodAssist {...props()} />);
  return {
    ...handlers,
    rerender: (more: Partial<FoodAssistProps>) => view.rerender(<FoodAssist {...props(more)} />),
  };
}

const first = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const photoButton = () =>
  screen.getByRole('button', { name: 'Порахувати калорії за фото' }) as HTMLButtonElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const describedBy = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

/** WCAG 2.5.3: the accessible name contains the visible label (the emoji are decoration). */
function labelInName(button: HTMLElement) {
  const visible = Array.from(button.childNodes)
    .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
    .map((n) => n.textContent)
    .join('')
    .trim()
    .toLocaleLowerCase('uk');
  expect((button.getAttribute('aria-label') ?? '').toLocaleLowerCase('uk')).toContain(visible);
}

describe('FoodAssist: the AI row', () => {
  it('«✨ Порахувати» counts the meal text; the emoji are decoration', () => {
    const { onCount } = setup();
    const count = first('Порахувати калорії');
    expect(count.textContent).toBe('✨ Порахувати');
    expect(count.querySelector('[aria-hidden="true"]')?.textContent).toBe('✨');
    expect(count.hasAttribute('aria-expanded')).toBe(false);
    fireEvent.click(count);
    expect(onCount).toHaveBeenCalledOnce();
    expect(photoButton().textContent).toBe('📷 Фото');
    labelInName(count);
    labelInName(photoButton());
  });

  it('with the meal text empty it is dimmed, says why to VoiceOver, and the tap still leads to the text', () => {
    const { onCount } = setup({ countHint: { id: 'count-hint', text: 'Опиши, що їла' } });
    const count = first('Порахувати калорії');
    expect(count.getAttribute('aria-disabled')).toBe('true');
    expect(count.disabled).toBe(false);
    expect(describedBy(count)).toEqual(['Опиши, що їла']);
    // A description, not one more line under the buttons (they sit above the text).
    expect(document.getElementById('count-hint')?.className).toBe('visually-hidden');
    fireEvent.click(count);
    expect(onCount).toHaveBeenCalledOnce();
    // The photo needs no text.
    expect(photoButton().hasAttribute('aria-disabled')).toBe(false);
  });

  it('«✨ Порахувати решту» names the tail it counts', () => {
    const { onCount } = setup({ mode: 'rest', tail: 'яблуко, кава' });
    const rest = first('Порахувати решту: яблуко, кава');
    expect(rest.textContent).toBe('✨ Порахувати решту');
    labelInName(rest);
    fireEvent.click(rest);
    expect(onCount).toHaveBeenCalledOnce();
  });

  it('«✨ Додати ще» opens the composer «Що ще порахувати?»: Enter or «Порахувати» sends it', () => {
    const { onToggleComposer, onComposerText, onSubmitComposer, rerender } = setup({ mode: 'more' });
    const more = first('Додати ще: порахувати калорії');
    expect(more.textContent).toBe('✨ Додати ще');
    labelInName(more);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(onToggleComposer).toHaveBeenCalledOnce();

    rerender({ composerOpen: true, composerText: '' });
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const composer = screen.getByRole('textbox', { name: 'Що ще порахувати?' });
    expect(more.getAttribute('aria-controls')).toBe(composer.parentElement?.id);
    const send = screen.getByRole('button', { name: 'Порахувати' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);
    expect(onSubmitComposer).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: 'яблуко' } });
    expect(onComposerText).toHaveBeenCalledWith('яблуко');

    rerender({ composerOpen: true, composerText: 'яблуко' });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(onSubmitComposer).toHaveBeenCalledOnce();
    // Shift+Enter is a new line.
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(onSubmitComposer).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати' }));
    expect(onSubmitComposer).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Можна додати й фото')).toBeTruthy();
  });

  it('«📷 Фото» opens the picker (any image, no forced camera) and hands over the file', () => {
    const { onPhoto } = setup();
    const input = fileInput();
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.hasAttribute('capture')).toBe(false);
    const click = vi.spyOn(input, 'click');
    fireEvent.click(photoButton());
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPhoto).toHaveBeenCalledWith(file);
  });

  it('12 photos on the day: «📷 Фото» is locked with the reason under the row', () => {
    const { onPhoto } = setup({ photoHint: { id: 'photo-hint', text: 'Не більше 12 фото на день' } });
    const click = vi.spyOn(fileInput(), 'click');
    expect(photoButton().getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(photoButton())).toEqual(['Не більше 12 фото на день']);
    expect(screen.getByText('Не більше 12 фото на день').tagName).toBe('P');
    fireEvent.click(photoButton());
    expect(click).not.toHaveBeenCalled();
    expect(onPhoto).not.toHaveBeenCalled();
    expect(first('Порахувати калорії').hasAttribute('aria-disabled')).toBe(false);
  });

  it('offline, out of estimates or 30 positions: both locked, one line says why; focus stays on them', () => {
    const { onCount, rerender } = setup();
    first('Порахувати калорії').focus();
    rerender({ blocked: { id: 'blocked', text: 'Потрібен інтернет' } });
    const count = first('Порахувати калорії');
    expect(document.activeElement).toBe(count);
    for (const button of [count, photoButton()]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(describedBy(button)).toEqual(['Потрібен інтернет']);
    }
    fireEvent.click(count);
    expect(onCount).not.toHaveBeenCalled();
    rerender({ blocked: { id: 'blocked', text: 'Не більше 30 позицій' } });
    expect(screen.getByText('Не більше 30 позицій')).toBeTruthy();
    // The positions card's alert says it already (a 429 on «Перерахувати»): no second line here.
    rerender({ blocked: { id: 'blocked', text: 'Потрібен інтернет' }, blockedInCard: true });
    expect(screen.queryByText('Потрібен інтернет')).toBeNull();
    expect(count.getAttribute('aria-describedby')).toBe('blocked');
  });

  it('an open composer can still be folded away while estimating is impossible', () => {
    const { onToggleComposer } = setup({
      mode: 'more',
      composerOpen: true,
      blocked: { id: 'blocked', text: 'Потрібен інтернет' },
    });
    const more = first('Додати ще: порахувати калорії');
    expect(more.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(more);
    expect(onToggleComposer).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Порахувати' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('the last failure is an inline alert; a 429 is the one line the buttons are described by', () => {
    const { rerender } = setup({
      error: 'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)',
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)',
    );
    const limit = 'Ліміт підрахунків на сьогодні вичерпано';
    rerender({ error: limit, blocked: { id: 'blocked', text: limit } });
    expect(screen.getAllByText(limit)).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('blocked');
    expect(photoButton().getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('while a request runs both wait (focusable), and the composer is put away', () => {
    const { onCount, onPhoto } = setup({ busy: true, mode: 'more', composerOpen: true, composerText: 'x' });
    expect(screen.queryByRole('textbox', { name: 'Що ще порахувати?' })).toBeNull();
    const more = first('Додати ще: порахувати калорії');
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(photoButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(photoButton());
    expect(onPhoto).not.toHaveBeenCalled();
    expect(onCount).not.toHaveBeenCalled();
  });
});

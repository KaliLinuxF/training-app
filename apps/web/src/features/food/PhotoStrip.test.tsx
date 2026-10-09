import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoStrip } from './PhotoStrip';
import { swipeResult } from './PhotoViewer';

afterEach(cleanup);

const IDS = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'];

describe('PhotoStrip', () => {
  it('renders lazy thumbnails at the requested size', () => {
    render(<PhotoStrip ids={IDS} size="sm" />);
    const imgs = screen.getAllByRole('img', { name: 'Фото їжі' });
    expect(imgs).toHaveLength(3);
    expect(imgs[0]!.getAttribute('src')).toBe('/api/photos/aaaaaaaaaaaaaaaa/thumb');
    expect(imgs[0]!.getAttribute('loading')).toBe('lazy');
    expect(imgs[0]!.getAttribute('width')).toBe('48');
    expect(screen.queryByRole('button', { name: 'Видалити фото' })).toBeNull();
  });

  it('renders nothing without photos', () => {
    const { container } = render(<PhotoStrip ids={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('remove badges call onRemove', () => {
    const onRemove = vi.fn();
    render(<PhotoStrip ids={IDS} onRemove={onRemove} />);
    const removes = screen.getAllByRole('button', { name: 'Видалити фото' });
    expect(removes).toHaveLength(3);
    fireEvent.click(removes[1]!);
    expect(onRemove).toHaveBeenCalledWith('bbbbbbbbbbbbbbbb');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after a removal focus moves to the next ✕ (or the previous), and past the strip once it is empty', () => {
    function Harness() {
      const [ids, setIds] = useState(IDS);
      return (
        <div role="dialog">
          <PhotoStrip ids={ids} onRemove={(id) => setIds((all) => all.filter((x) => x !== id))} />
          <button type="button">Далі</button>
        </div>
      );
    }
    render(<Harness />);
    const removes = () => screen.getAllByRole('button', { name: 'Видалити фото' });
    fireEvent.click(removes()[0]!);
    expect(removes()).toHaveLength(2);
    expect(document.activeElement).toBe(removes()[0]);
    fireEvent.click(removes()[1]!);
    expect(document.activeElement).toBe(removes()[0]);
    fireEvent.click(removes()[0]!);
    expect(screen.queryByRole('button', { name: 'Видалити фото' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Далі' }));
  });

  it('a broken thumbnail becomes a placeholder', () => {
    render(<PhotoStrip ids={IDS.slice(0, 1)} />);
    fireEvent.error(screen.getByRole('img', { name: 'Фото їжі' }));
    expect(screen.queryByRole('img', { name: 'Фото їжі' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Фото їжі (не вдалося завантажити)' })).toBeTruthy();
  });

  it('opens the viewer, pages with arrows and closes with Escape without reaching outer handlers', () => {
    const outerEscape = vi.fn();
    document.addEventListener('keydown', outerEscape);
    try {
      render(<PhotoStrip ids={IDS} />);
      const thumbs = screen.getAllByRole('button', { name: 'Фото їжі' });
      fireEvent.click(thumbs[1]!);

      const dialog = screen.getByRole('dialog', { name: 'Фото їжі' });
      expect(dialog.parentElement).toBe(document.body);
      expect(screen.getByText('2 / 3')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрити' }));
      const full = () => dialog.querySelector('img[alt="Фото їжі"]')!.getAttribute('src');
      expect(full()).toBe('/api/photos/bbbbbbbbbbbbbbbb');

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText('3 / 3')).toBeTruthy();
      expect(full()).toBe('/api/photos/cccccccccccccccc');
      expect((screen.getByRole('button', { name: 'Наступне фото' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Попереднє фото' }));
      expect(screen.getByText('2 / 3')).toBeTruthy();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(outerEscape).not.toHaveBeenCalled();
      // Focus returns to the thumbnail that opened it.
      expect(document.activeElement).toBe(thumbs[1]);
    } finally {
      document.removeEventListener('keydown', outerEscape);
    }
  });

  it('the viewer falls back to the thumbnail when the full photo fails, then to a message', () => {
    render(<PhotoStrip ids={IDS.slice(0, 1)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Фото їжі' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.error(dialog.querySelector('img[src="/api/photos/aaaaaaaaaaaaaaaa"]')!);
    const shown = dialog.querySelector('img[alt="Фото їжі"]')!;
    expect(shown.getAttribute('src')).toBe('/api/photos/aaaaaaaaaaaaaaaa/thumb');
    fireEvent.error(shown);
    expect(screen.getByText('Фото недоступне')).toBeTruthy();
  });

  it('a single photo has no paging controls; ✕ closes', () => {
    render(<PhotoStrip ids={IDS.slice(0, 1)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Фото їжі' }));
    expect(screen.queryByRole('button', { name: 'Наступне фото' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('swipeResult', () => {
  it('horizontal swipes page, a long downward one closes, small moves do nothing', () => {
    expect(swipeResult(-80, 10)).toBe('next');
    expect(swipeResult(90, -20)).toBe('prev');
    expect(swipeResult(10, 140)).toBe('close');
    expect(swipeResult(30, 20)).toBeNull();
    expect(swipeResult(-70, 90)).toBeNull();
    expect(swipeResult(0, -150)).toBeNull();
  });
});

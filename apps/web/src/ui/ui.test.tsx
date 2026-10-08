import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, useUiStore } from '@/store/ui';
import { Banner } from './feedback/Banner';
import { ProgressBar } from './feedback/ProgressBar';
import { Toast } from './feedback/Toast';
import { lockScroll } from './internal/scrollLock';
import { stubScrollTo } from './internal/testing';
import { DetailRow } from './tiles/DetailRow';
import { Tile } from './tiles/Tile';
import { deltaTone } from './tone';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('deltaTone', () => {
  it('ports the prototype tone(): down is mint, up is lavender, ~0 or missing is ink', () => {
    expect(deltaTone(-0.4)).toBe('acc2');
    expect(deltaTone(1)).toBe('acc');
    expect(deltaTone(0.04)).toBe('ink');
    expect(deltaTone(-0.04)).toBe('ink');
    expect(deltaTone(null)).toBe('ink');
    expect(deltaTone(undefined)).toBe('ink');
    expect(deltaTone(Number.NaN)).toBe('ink');
  });
});

describe('lockScroll', () => {
  it('pins the body and restores it when the last lock is released', () => {
    const scrollTo = stubScrollTo();
    const a = lockScroll();
    const b = lockScroll();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    a();
    a(); // idempotent
    expect(document.body.style.position).toBe('fixed');
    b();
    expect(document.documentElement.classList.contains('scroll-locked')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});

describe('Toast', () => {
  it('shows the flashed text in a live region and removes it after it fades out', () => {
    vi.useFakeTimers();
    render(<Toast />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    act(() => ui.flash('Збережено', 1000));
    expect(region.textContent).toBe('Збережено');
    act(() => vi.advanceTimersByTime(1000));
    expect(useUiStore.getState().toast).toBeNull();
    // Still visible during the exit transition…
    expect(region.textContent).toBe('Збережено');
    act(() => vi.advanceTimersByTime(500));
    expect(region.textContent).toBe('');
  });
});

describe('Tile', () => {
  it('becomes a button when clickable', () => {
    const onClick = vi.fn();
    render(<Tile variant="entry" label="Харчування" value="Записано" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Харчування/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('DetailRow', () => {
  it('shows a dash for empty values', () => {
    render(
      <>
        <DetailRow label="Нотатки" value="" />
        <DetailRow label="Вага" value="65,4 кг" />
      </>,
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('65,4 кг')).toBeTruthy();
  });
});

describe('ProgressBar', () => {
  it('clamps the fill and is decorative without a label', () => {
    const { container, rerender } = render(<ProgressBar value={140} />);
    const track = container.firstElementChild as HTMLElement;
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect((track.firstElementChild as HTMLElement).style.width).toBe('100%');
    rerender(<ProgressBar value={42.4} label="Шлях до цілі" />);
    const bar = screen.getByRole('progressbar', { name: 'Шлях до цілі' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });
});

describe('Banner', () => {
  it('fires the CTA', () => {
    const onAction = vi.fn();
    render(
      <Banner title="Контрольне зважування" sub="Сьогодні о 08:00" cta="Записати" onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Записати' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

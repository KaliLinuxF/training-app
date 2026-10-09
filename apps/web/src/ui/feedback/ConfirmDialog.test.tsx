import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from './ConfirmDialog';

afterEach(() => useUiStore.setState({ confirm: null }));

describe('ui.confirm + ConfirmHost', () => {
  it('resolves true on confirm and closes', async () => {
    render(<ConfirmHost />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = ui.confirm({ title: 'Вийти?', body: 'Нагадування зупиняться', confirmLabel: 'Вийти' });
    });
    expect(screen.getByRole('alertdialog', { name: 'Вийти?' })).toBeTruthy();
    expect(screen.getByText('Нагадування зупиняться')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resolves false on Escape and on a newer request', async () => {
    render(<ConfirmHost />);
    let first: Promise<boolean> = Promise.resolve(true);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = ui.confirm({ title: 'Перше' });
    });
    act(() => {
      second = ui.confirm({ title: 'Друге', destructive: true });
    });
    await expect(first).resolves.toBe(false);
    expect(document.activeElement?.textContent).toBe('Скасувати');
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await expect(second).resolves.toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

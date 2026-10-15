import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_FAILED, SaveFooter } from './fields';

afterEach(cleanup);

const button = () => screen.getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement;

describe('SaveFooter', () => {
  it('a hint says why the button waits and describes it', () => {
    render(<SaveFooter label="Зберегти" onSave={() => undefined} disabled hint="Опиши, що їла" />);
    const hint = screen.getByText('Опиши, що їла');
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-describedby')).toBe(hint.id);
    // A hint is not an alert.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an error wins over the hint and is announced', () => {
    render(
      <SaveFooter label="Зберегти" onSave={() => undefined} disabled={false} error={SAVE_FAILED} hint="x" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(SAVE_FAILED);
    expect(screen.queryByText('x')).toBeNull();
    expect(button().getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('neither: no description; a tap saves', () => {
    const onSave = vi.fn();
    render(<SaveFooter label="Зберегти" onSave={onSave} disabled={false} />);
    expect(button().hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(button());
    expect(onSave).toHaveBeenCalledOnce();
  });
});

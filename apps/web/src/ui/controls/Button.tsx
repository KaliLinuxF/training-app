import type { ComponentPropsWithRef } from 'react';
import { cx } from '../internal/cx';
import s from './Button.module.css';

/**
 * - `solid`   — dark button (`--solid` / `--onSolid`): «Зберегти», «Редагувати день», banner CTA
 * - `accent`  — lavender (`--acc` / `--onAcc`, 700, nowrap): «Увімкнути» on the notifications panel
 * - `outline` — card background with a `--line` border
 * - `ghost`   — muted text link «Відкрити день →» (14/500, padding 8px 0; `size` is ignored)
 */
export type ButtonVariant = 'solid' | 'accent' | 'outline' | 'ghost';

/**
 * - `sm` — 14/600, padding 10/14, r12, min-height 40 (44 for `accent`); tap area grown invisibly to 44
 * - `md` — 15/600, r14, min-height 50
 * - `lg` — 16/700, r16, min-height 56 (sheet footer «Зберегти»)
 */
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'solid',
  size = 'md',
  fullWidth,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.button, variant !== 'ghost' && s[size], s[variant], fullWidth && s.full, className)}
      {...rest}
    />
  );
}

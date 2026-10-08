import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Accessible name (required: the button only shows a glyph). */
  label: string;
  /** Glyph: «‹», «›», «−», «+». */
  children: ReactNode;
  /** Background: `paper` (calendar month, steppers) or `card` (sheet date navigation). */
  surface?: 'paper' | 'card';
  /** `nav` — r14, 18px glyph (‹ ›); `step` — r12, 20px glyph (− +). Both 44×44 with a `--line` border. */
  shape?: 'nav' | 'step';
}

/** Square 44px glyph button; `disabled` shows the glyph in `--faint`. */
export function IconButton({
  label,
  children,
  surface = 'paper',
  shape = 'nav',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(s.button, s[surface], s[shape], className)}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

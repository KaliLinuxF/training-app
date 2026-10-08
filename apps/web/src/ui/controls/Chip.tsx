import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../internal/cx';
import { useFieldA11y } from './Field';
import s from './Chip.module.css';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  selected: boolean;
  children: ReactNode;
}

/** Toggleable pill (workout types): min-height 44, padding 0 16; selected = lavender tint + accent border. */
export function Chip({ selected, type = 'button', className, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(s.chip, selected && s.selected, className)}
      {...rest}
    />
  );
}

export interface ChipGroupProps {
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/** Wrapping row of chips, gap 8. */
export function ChipGroup({ children, className, ...aria }: ChipGroupProps) {
  const a11y = useFieldA11y(aria);
  return (
    <div
      role="group"
      aria-label={a11y['aria-label']}
      aria-labelledby={a11y['aria-labelledby']}
      className={cx(s.group, className)}
    >
      {children}
    </div>
  );
}

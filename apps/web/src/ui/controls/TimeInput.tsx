import type { InputHTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import s from './TimeInput.module.css';

export interface TimeInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  /** `HH:MM`. */
  value: string;
  /** Called with the new `HH:MM` (ignores the empty value browsers emit while clearing). */
  onChange: (value: string) => void;
}

/** Reminder time input: 17/600, paper background, r12, min-height 44. */
export function TimeInput({ value, onChange, className, ...rest }: TimeInputProps) {
  return (
    <input
      type="time"
      className={cx(s.input, className)}
      value={value}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
      {...rest}
    />
  );
}

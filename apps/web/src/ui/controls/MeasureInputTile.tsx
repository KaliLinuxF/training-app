import type { InputHTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import s from './MeasureInputTile.module.css';

export interface MeasureInputTileProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode' | 'size'
> {
  /** «Груди», «Талія», «Стегна». */
  label: string;
  /** Raw text («70,5»). */
  value: string;
  onChange: (value: string) => void;
  /** Previous value as a hint («74»), or «—». */
  placeholder?: string;
  unit?: string;
}

/** Measurement input tile: label 13 muted, big 22/700 input with «см» suffix. The whole tile is the <label>. */
export function MeasureInputTile({
  label,
  value,
  onChange,
  placeholder = '—',
  unit = 'см',
  className,
  ...rest
}: MeasureInputTileProps) {
  return (
    <label className={cx(s.tile, className)}>
      <span className={s.label}>{label}</span>
      <span className={s.row}>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          className={s.input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        <span className={s.unit}>{unit}</span>
      </span>
    </label>
  );
}

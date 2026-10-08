import { cx } from '../internal/cx';
import { handleRadioKeyDown } from '../internal/radioKeys';
import s from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group («Період»). */
  'aria-label': string;
  /** Stick to the top of the viewport while scrolling (Progress period switcher). */
  sticky?: boolean;
  /** Span all columns of a <ContentGrid>. */
  full?: boolean;
  className?: string;
}

/**
 * Period switcher «Тиждень · Місяць · 3 міс. · Весь час»: equal columns on a `--line` track.
 * Radio-group semantics: one tab stop, arrow keys move the selection.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  sticky,
  full,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const select = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(s.track, sticky && s.sticky, full && s.full, className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={cx(s.item, checked && s.active)}
            onClick={() => select(index)}
            onKeyDown={(e) => handleRadioKeyDown(e, index, options.length, select)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

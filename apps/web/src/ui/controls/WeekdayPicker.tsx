import { DOW_LONG, DOW_SHORT, WEEK_ORDER, type Weekday } from '@legko/shared';
import { cx } from '../internal/cx';
import { handleRadioKeyDown } from '../internal/radioKeys';
import s from './WeekdayPicker.module.css';

interface BaseProps {
  /** Accessible name of the group («Дні тренувань»). */
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

export interface WeekdayPickerMultiProps extends BaseProps {
  mode: 'multi';
  value: readonly Weekday[];
  /** New selection, sorted Monday-first. */
  onChange: (days: Weekday[]) => void;
}

export interface WeekdayPickerSingleProps extends BaseProps {
  mode: 'single';
  value: Weekday;
  onChange: (day: Weekday) => void;
}

export type WeekdayPickerProps = WeekdayPickerMultiProps | WeekdayPickerSingleProps;

/** Toggles `day` in `days`, keeping Monday-first order. */
export function toggleWeekday(days: readonly Weekday[], day: Weekday): Weekday[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return WEEK_ORDER.filter((d) => next.includes(d));
}

const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Seven Monday-first day buttons «Пн … Нд». `multi` (workout days) uses toggle buttons
 * (`aria-pressed`); `single` (weigh-in / measurements day) is a radio group.
 */
export function WeekdayPicker(props: WeekdayPickerProps) {
  const { disabled, className, 'aria-label': ariaLabel } = props;
  const isOn = (d: Weekday): boolean =>
    props.mode === 'multi' ? props.value.includes(d) : props.value === d;

  const press = (d: Weekday) => {
    if (props.mode === 'multi') props.onChange(toggleWeekday(props.value, d));
    else if (props.value !== d) props.onChange(d);
  };

  const single = props.mode === 'single';
  return (
    <div role={single ? 'radiogroup' : 'group'} aria-label={ariaLabel} className={cx(s.picker, className)}>
      {WEEK_ORDER.map((d, index) => {
        const on = isOn(d);
        const selectAt = (i: number) => {
          const day = WEEK_ORDER[i];
          if (day !== undefined) press(day);
        };
        return (
          <button
            key={d}
            type="button"
            disabled={disabled}
            aria-label={capitalize(DOW_LONG[d])}
            className={cx(s.day, on && s.on)}
            onClick={() => press(d)}
            role={single ? 'radio' : undefined}
            aria-checked={single ? on : undefined}
            aria-pressed={single ? undefined : on}
            tabIndex={single ? (on ? 0 : -1) : undefined}
            onKeyDown={single ? (e) => handleRadioKeyDown(e, index, WEEK_ORDER.length, selectAt) : undefined}
          >
            {DOW_SHORT[d]}
          </button>
        );
      })}
    </div>
  );
}

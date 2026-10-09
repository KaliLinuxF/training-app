import { cx } from '../internal/cx';
import { useFieldA11y } from './Field';
import s from './TrainingToggle.module.css';

export interface TrainingToggleProps {
  /** `true` = «Було», `false` = «Не було», `null` = not marked yet. */
  value: boolean | null;
  /** Called on every press (also when the pressed option is already selected). */
  onChange: (trained: boolean) => void;
  /**
   * - `sm` — two 44×44 glyph buttons «✓» / «✕» (gap 6) next to a list row; names stay «Було» / «Не було»
   * - `md` — Home card (min-height 50, r14, 15px)
   * - `lg` — day sheet (54, r16, 16px)
   */
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/** The «✓ Було / ✕ Не було» pair. */
export function TrainingToggle({ value, onChange, size = 'md', className, ...aria }: TrainingToggleProps) {
  const a11y = useFieldA11y(aria);
  const groupLabel = a11y['aria-label'] ?? (a11y['aria-labelledby'] ? undefined : 'Тренування');
  const compact = size === 'sm';
  return (
    <div
      role="group"
      aria-label={groupLabel}
      aria-labelledby={a11y['aria-labelledby']}
      className={cx(s.toggle, s[size], className)}
    >
      <button
        type="button"
        aria-pressed={value === true}
        className={cx(s.option, value === true && s.yes)}
        onClick={() => onChange(true)}
      >
        {compact ? (
          <>
            <span className={s.glyph} aria-hidden="true">
              ✓
            </span>
            <span className="visually-hidden">Було</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">✓</span> Було
          </>
        )}
      </button>
      <button
        type="button"
        aria-pressed={value === false}
        className={cx(s.option, value === false && s.no)}
        onClick={() => onChange(false)}
      >
        {compact ? (
          <>
            <span className={s.glyph} aria-hidden="true">
              ✕
            </span>
            <span className="visually-hidden">Не було</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">✕</span> Не було
          </>
        )}
      </button>
    </div>
  );
}

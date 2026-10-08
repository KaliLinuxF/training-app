import { createContext, useContext, useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './Field.module.css';

interface FieldIds {
  labelId: string;
  hintId: string | undefined;
}

const FieldContext = createContext<FieldIds | null>(null);

/**
 * ARIA wiring for controls rendered inside a <Field>: they label themselves with the field label
 * (`aria-labelledby`) and describe themselves with its hint, unless explicit props are given.
 */
export function useFieldA11y(explicit: {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}): {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
} {
  const field = useContext(FieldContext);
  const labelled = explicit['aria-label'] !== undefined || explicit['aria-labelledby'] !== undefined;
  return {
    'aria-label': explicit['aria-label'],
    'aria-labelledby': explicit['aria-labelledby'] ?? (labelled ? undefined : field?.labelId),
    'aria-describedby': explicit['aria-describedby'] ?? field?.hintId,
  };
}

export interface FieldProps {
  /** Small caps-like label above the control: 13/600 muted («Що я їла», «Калорії за день»). */
  label: ReactNode;
  /** Muted 13px line under the control («Попереднє: 3 жовтня — 65,8 кг»). */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Sheet form block: label, control(s), optional hint — column with gap 10. */
export function Field({ label, hint, children, className }: FieldProps) {
  const labelId = useId();
  const hintId = useId();
  const ids: FieldIds = { labelId, hintId: hint != null ? hintId : undefined };
  return (
    <FieldContext value={ids}>
      <div className={cx(s.field, className)}>
        <span id={labelId} className={s.label}>
          {label}
        </span>
        {children}
        {hint != null && (
          <span id={hintId} className={s.hint}>
            {hint}
          </span>
        )}
      </div>
    </FieldContext>
  );
}

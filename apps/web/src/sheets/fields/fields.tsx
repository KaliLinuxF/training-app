/** Form blocks shared by the record and setup sheets (prototype lines 457–492). */
import { fN, num, type MeasureKey } from '@legko/shared';
import { useId, type ReactNode } from 'react';
import { KcalGoalLine, kcalGoalView } from '@/features/goal';
import { MEASURE_LABELS } from '@/lib/stats';
import { Button, cx, Field, MeasureInputTile, NumberStepperField, useFieldA11y } from '@/ui';
import { stepKcal, stepSteps, stepWeight, type StepRange } from '../helpers';
import { digitsOnly, groupedSteps, MEASURE_KEYS, type MeasureError, type MeasureTexts } from '../validation';
import s from './fields.module.css';

/** Inline validation message under a control: 13px, `--accD`, announced when it appears. */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <span id={id} className={s.error} role="alert">
      {message}
    </span>
  );
}

/** Shown above «Зберегти» when the store refused the save (nothing was applied, the draft stays). */
export const SAVE_FAILED = 'Не вдалося зберегти — перевір дані й спробуй ще раз';

export interface SaveFooterProps {
  label: string;
  onSave: () => void;
  disabled: boolean;
  /** Message above the button (e.g. `SAVE_FAILED`), announced. */
  error?: string;
  /** Why the button waits («Опиши, що їла, або додай калорії чи фото»): a muted line above it; the error wins. */
  hint?: string;
}

/**
 * Sheet footer: full-width «Зберегти» / «Почати» (lg) with an optional inline error — or, without one, a hint —
 * above it; the line describes the button (`aria-describedby`).
 */
export function SaveFooter({ label, onSave, disabled, error, hint }: SaveFooterProps) {
  const errId = useId();
  const hintId = useId();
  const showHint = !error && !!hint;
  const describedBy = error ? errId : showHint ? hintId : undefined;
  return (
    <div className={s.footer}>
      <FieldError id={errId} message={error} />
      {showHint && (
        <span id={hintId} className={s.hint}>
          {hint}
        </span>
      )}
      <Button size="lg" fullWidth onClick={onSave} disabled={disabled} aria-describedby={describedBy}>
        {label}
      </Button>
    </div>
  );
}

const stepText = (step: number): string => fN(step);

export interface WeightFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  /** Starting point of ± when the input is empty (latest weigh-in). */
  base: number | null;
  /** 0,1 for weigh-ins, 0,5 for the goal. */
  step?: number;
  /** ± never leaves these bounds (the goal). */
  range?: StepRange;
  error: string | undefined;
  name?: string;
}

/** «Вага» — big kg input with ± buttons (lg). */
export function WeightField({ label, hint, value, onChange, base, step = 0.1, range, error, name }: WeightFieldProps) {
  const errId = useId();
  const t = stepText(step);
  return (
    <Field label={label} hint={hint}>
      <NumberStepperField
        size="lg"
        unit="кг"
        inputMode="decimal"
        placeholder="—"
        name={name}
        value={value}
        onChange={onChange}
        decrementText={`−${t}`}
        incrementText={`+${t}`}
        decrementLabel={`Мінус ${t} кг`}
        incrementLabel={`Плюс ${t} кг`}
        onDecrement={() => onChange(stepWeight(value, base, -step, range))}
        onIncrement={() => onChange(stepWeight(value, base, step, range))}
        className={error ? s.invalid : undefined}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <FieldError id={errId} message={error} />
    </Field>
  );
}

export interface KcalFieldProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** ± never leaves these bounds (the daily goal). */
  range?: StepRange;
  error: string | undefined;
  name?: string;
  /** Daily kcal goal: shows a live «Залишилось … / Перевищено …» line under the field. */
  goal?: number;
}

/** «Калорії за день» — kcal input with −50 / +50 (md), digits only. */
export function KcalField({ label, value, onChange, range, error, name, goal }: KcalFieldProps) {
  const errId = useId();
  const hint = goal != null && !error ? <KcalGoalLine view={kcalGoalView(num(value), goal)} /> : undefined;
  return (
    <Field label={label} hint={hint}>
      <NumberStepperField
        size="md"
        unit="ккал"
        inputMode="numeric"
        placeholder="0"
        name={name}
        maxLength={6}
        value={value}
        onChange={(text) => onChange(digitsOnly(text))}
        decrementText="−50"
        incrementText="+50"
        decrementLabel="Мінус 50 ккал"
        incrementLabel="Плюс 50 ккал"
        onDecrement={() => onChange(stepKcal(value, -50, range))}
        onIncrement={() => onChange(stepKcal(value, 50, range))}
        className={error ? s.invalid : undefined}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <FieldError id={errId} message={error} />
    </Field>
  );
}

export interface MeasureFieldProps {
  label: string;
  values: MeasureTexts;
  /** Previous values («74») shown as placeholders. */
  placeholders: MeasureTexts;
  onChange: (key: MeasureKey, text: string) => void;
  error: MeasureError;
}

/** «Заміри» — chest · waist · hips tiles in three columns. */
export function MeasureField({ label, values, placeholders, onChange, error }: MeasureFieldProps) {
  const errId = useId();
  return (
    <Field label={label}>
      <div className={s.measureGrid}>
        {MEASURE_KEYS.map((key) => {
          const invalid = error.invalid.includes(key);
          return (
            <MeasureInputTile
              key={key}
              name={key}
              label={MEASURE_LABELS[key]}
              value={values[key]}
              placeholder={placeholders[key]}
              onChange={(text) => onChange(key, text)}
              className={invalid ? s.tileInvalid : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errId : undefined}
            />
          );
        })}
      </div>
      <FieldError id={errId} message={error.message} />
    </Field>
  );
}

/** The four steppers of the steps sheet: −1000, −500, +500, +1000. */
export const STEPS_DELTAS: readonly number[] = [-1000, -500, 500, 1000];

const deltaText = (d: number): string => `${d < 0 ? '−' : '+'}${Math.abs(d)}`;
const deltaLabel = (d: number): string => `${d < 0 ? 'Мінус' : 'Плюс'} ${Math.abs(d)} кроків`;

export interface StepsFieldProps {
  /** Digits only («8400»), '' = none. */
  value: string;
  onChange: (digits: string) => void;
  /** Under the steppers: the goal line or «≈ 280 ккал». */
  hint?: ReactNode;
  error: string | undefined;
  /** The big input with ±500 / ±1000 (the «Кроки» sheet), or one plain input (the full day). */
  variant: 'sheet' | 'day';
}

/**
 * «Кроки за день»: one whole number typed by hand (no device integration). The sheet shows a big 34px input and four
 * 44px steppers (clamped to 0…100 000); the full day a single input. The digits are shown grouped («8 400»).
 */
export function StepsField({ value, onChange, hint, error, variant }: StepsFieldProps) {
  const errId = useId();
  const label = variant === 'sheet' ? 'Кроки за день' : 'Кроки (за бажанням)';
  return (
    <Field label={label} hint={hint}>
      <StepsInput value={value} onChange={onChange} big={variant === 'sheet'} error={error} errId={errId} />
      {variant === 'sheet' && (
        <div className={s.stepsButtons}>
          {STEPS_DELTAS.map((d) => (
            <Button
              key={d}
              variant="outline"
              size="sm"
              className={s.stepsButton}
              aria-label={deltaLabel(d)}
              onClick={() => onChange(stepSteps(value, d))}
            >
              {deltaText(d)}
            </Button>
          ))}
        </div>
      )}
      <FieldError id={errId} message={error} />
    </Field>
  );
}

interface StepsInputProps {
  value: string;
  onChange: (digits: string) => void;
  big: boolean;
  error: string | undefined;
  errId: string;
}

/** The input itself (inside the Field, so it is labelled by it and described by its hint). */
function StepsInput({ value, onChange, big, error, errId }: StepsInputProps) {
  const unitId = useId();
  const a11y = useFieldA11y({});
  const describedBy = [unitId, a11y['aria-describedby']].filter(Boolean).join(' ');
  return (
    <div className={cx(s.stepsWrap, big && s.stepsBig, error && s.invalid)}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        name="steps"
        placeholder="0"
        maxLength={7}
        className={s.stepsInput}
        value={groupedSteps(value)}
        onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 6))}
        aria-labelledby={a11y['aria-labelledby']}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? errId : undefined}
      />
      <span id={unitId} className={s.stepsUnit}>
        кроків
      </span>
    </div>
  );
}

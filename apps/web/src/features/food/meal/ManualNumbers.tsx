import { MACRO_KEYS, type MacroKey } from '@legko/shared';
import { useId, useRef, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { MACRO_LABELS } from '@/lib/nutrition';
import { Button } from '@/ui';
import type { MacroTexts } from './mealModel';
import s from './MealEditorBody.module.css';

export interface ManualNumbersProps {
  kcalText: string;
  macroTexts: MacroTexts;
  /** The three macro inputs are shown. */
  macrosOpen: boolean;
  kcalError?: string;
  macroError?: string;
  onKcal: (value: string) => void;
  onMacro: (key: MacroKey, value: string) => void;
  onOpenMacros: () => void;
}

/** «Готово» on the iPhone keyboard just closes it; never submits anything around the editor. */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/**
 * A meal without positions: «Калорії» (whole kcal) and, folded behind «+ Б · Ж · В» until she
 * opens it (or the meal has a typed macro), Білки / Жири / Вуглеводи in grams (0,5 g steps).
 */
export function ManualNumbers({
  kcalText,
  macroTexts,
  macrosOpen,
  kcalError,
  macroError,
  onKcal,
  onMacro,
  onOpenMacros,
}: ManualNumbersProps) {
  const kcalId = useId();
  const kcalErrorId = useId();
  const macroErrorId = useId();
  const proteinRef = useRef<HTMLInputElement>(null);

  const open = () => {
    // Rendered and focused inside the tap, so the iPhone keyboard opens with it.
    flushSync(onOpenMacros);
    proteinRef.current?.focus();
  };

  return (
    <div className={s.manual}>
      <div className={s.field}>
        <label htmlFor={kcalId} className={s.label}>
          Калорії
        </label>
        <div className={s.suffixed}>
          <input
            id={kcalId}
            className={s.kcalInput}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={5}
            value={kcalText}
            placeholder="—"
            aria-invalid={kcalError ? true : undefined}
            aria-errormessage={kcalError ? kcalErrorId : undefined}
            onChange={(e) => onKcal(e.target.value)}
            onKeyDown={blurOnEnter}
          />
          <span className={s.suffix} aria-hidden="true">
            ккал
          </span>
        </div>
        {kcalError && (
          <p id={kcalErrorId} className={s.error}>
            {kcalError}
          </p>
        )}
      </div>

      {macrosOpen ? (
        <div className={s.field}>
          <div className={s.macroInputs}>
            {MACRO_KEYS.map((key) => (
              <label key={key} className={s.macroField}>
                <span className={s.label}>{MACRO_LABELS[key].name}</span>
                <span className={s.suffixed}>
                  <input
                    ref={key === 'protein' ? proteinRef : undefined}
                    className={s.macroInput}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                    value={macroTexts[key]}
                    placeholder="—"
                    aria-invalid={macroError ? true : undefined}
                    aria-errormessage={macroError ? macroErrorId : undefined}
                    onChange={(e) => onMacro(key, e.target.value)}
                    onKeyDown={blurOnEnter}
                  />
                  <span className={s.suffix} aria-hidden="true">
                    г
                  </span>
                </span>
              </label>
            ))}
          </div>
          {macroError && (
            <p id={macroErrorId} className={s.error}>
              {macroError}
            </p>
          )}
        </div>
      ) : (
        <Button
          variant="ghost"
          className={s.openMacros}
          aria-label="+ Б · Ж · В: білки, жири, вуглеводи"
          onClick={open}
        >
          + Б · Ж · В
        </Button>
      )}
    </div>
  );
}

import { useId, useState, type FormEvent } from 'react';
import { LIMITS, WORKOUT_TYPES } from '@legko/shared';
import { dataActions } from '@/store/data';
import { Button, Card } from '@/ui';
import { addCustomType, removeCustomType } from './model';
import s from './WorkoutTypesCard.module.css';

/**
 * «Мої тренування» (Налаштування → Типи тренувань): built-in types (fixed) and her own ones (removable), plus an
 * «add» form at the bottom. No card header: the intro line names the list of types.
 */
export function WorkoutTypesCard({ customTypes }: { customTypes: readonly string[] }) {
  const id = useId();
  const introId = `${id}intro`;
  const inputId = `${id}input`;
  const errorId = `${id}error`;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = addCustomType(customTypes, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dataActions.updateSettings((st) => ({ ...st, customTypes: addOrKeep(st.customTypes, result.name) }));
    setDraft('');
    setError(null);
  };

  const remove = (name: string) => {
    dataActions.updateSettings((st) => ({ ...st, customTypes: removeCustomType(st.customTypes, name) }));
  };

  return (
    <Card as="section" aria-label="Мої тренування">
      <p id={introId} className={s.intro}>
        Типи, які можна вибрати в записі дня
      </p>
      <ul className={s.types} aria-labelledby={introId}>
        {WORKOUT_TYPES.map((t) => (
          <li key={t} className={s.builtin}>
            {t}
          </li>
        ))}
        {customTypes.map((t) => (
          <li key={t} className={s.custom}>
            <span className={s.name}>{t}</span>
            <button
              type="button"
              className={s.remove}
              aria-label={`Видалити «${t}»`}
              onClick={() => remove(t)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className={s.form} onSubmit={add} noValidate>
        <label htmlFor={inputId} className="visually-hidden">
          Свій тип тренування
        </label>
        <input
          id={inputId}
          className={s.input}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Свій тип тренування"
          maxLength={LIMITS.typeName}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <Button type="submit" disabled={!draft.trim()}>
          Додати
        </Button>
      </form>
      {error && (
        <p id={errorId} className={s.error} role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/**
 * Applies the add on top of the latest stored list (it may have changed since render, e.g. a sync);
 * validation already ran against what she saw.
 */
function addOrKeep(current: readonly string[], name: string): string[] {
  const result = addCustomType(current, name);
  return result.ok ? result.types : [...current];
}

import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LIMITS } from '@legko/shared';
import { dataActions } from '@/store/data';
import { Button, Card, IconButton } from '@/ui';
import {
  addMealType,
  cleanTypeName,
  keyTypeRows,
  mealTypesNote,
  missingDefaults,
  moveMealType,
  NO_TYPE_ROWS,
  removeMealType,
  renameMealType,
  renameTypeRow,
  restoreDefaultMealTypes,
  type MealTypesEdit,
} from './model';
import s from './MealTypesCard.module.css';

type RowControl = 'up' | 'down' | 'remove';

/** Where the focus goes once the list has re-rendered (a moved or removed row, the add field). */
type FocusTarget = { control: RowControl; key: number } | { control: 'add' };

/** One error at a time: under the row being renamed, or under the add form (add / restore). */
type ShownError = { at: 'form'; text: string } | { at: 'row'; key: number; text: string };

export const MEAL_TYPES_INTRO = 'Типи, які можна вибрати для прийому їжі';
export const NEW_MEAL_TYPE_LABEL = 'Новий тип прийому їжі';

/**
 * Applies an edit on top of the latest stored list (it may have changed since render, e.g. a sync); the edit was
 * already validated against the list she saw. `false` = the store refused the settings.
 */
function applyToLatest(edit: (types: readonly string[]) => MealTypesEdit): boolean {
  return dataActions.updateSettings((st) => {
    const result = edit(st.mealTypes);
    return result.ok && result.changed ? { ...st, mealTypes: result.types } : st;
  });
}

/**
 * «Мої прийоми їжі» (Налаштування → Прийоми їжі, docs/meals-macros.md §7.10): her meal types in her order.
 *
 * - View mode (default): the names only, calm like «Типи тренувань».
 * - «Змінити» → edit mode: each name is a field (rename on blur / Enter, Escape reverts), with ↑ / ↓ and ✕. No
 *   confirmation on ✕: meals already logged keep their own label. Moves keep the focus on the same button of the
 *   moved row; at either end the button is `aria-disabled` (never natively disabled, so the focus stays on it).
 * - The add form and «Повернути стандартні» (only while a default type is missing) work in both modes.
 * - Moves, renames, removals and adds are announced in a polite status.
 * The note under the card says which type a new meal starts with at which time (generated from `suggestMealType`).
 */
export function MealTypesCard({ mealTypes }: { mealTypes: readonly string[] }) {
  const id = useId();
  const introId = `${id}intro`;
  const inputId = `${id}input`;
  const errorId = `${id}error`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** Unsaved names in the edit fields, by row key (absent = the field shows the stored name). */
  const [drafts, setDrafts] = useState<Readonly<Record<number, string>>>({});
  const [error, setError] = useState<ShownError | null>(null);
  /** `seq` re-renders the text as a new node, so the same message twice («Обід — вище») is announced twice. */
  const [status, setStatus] = useState({ seq: 0, text: '' });
  const [rowKeys, setRowKeys] = useState(() => keyTypeRows(NO_TYPE_ROWS, mealTypes));
  const keyed = keyTypeRows(rowKeys, mealTypes);
  if (keyed !== rowKeys) setRowKeys(keyed);
  const rows = keyed.rows;

  const listRef = useRef<HTMLOListElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el =
      target.control === 'add'
        ? addInput.current
        : listRef.current?.querySelector<HTMLButtonElement>(
            `button[data-control="${target.key}:${target.control}"]`,
          );
    el?.focus();
  });

  const announce = (text: string) => setStatus((st) => ({ seq: st.seq + 1, text }));

  const dropDraft = (key: number) =>
    setDrafts((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });

  const editingNow = editing && rows.length > 0;
  const missing = missingDefaults(mealTypes);
  const rowError = (key: number) => (error?.at === 'row' && error.key === key ? error : null);

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = addMealType(mealTypes, draft);
    if (!result.ok) {
      setError({ at: 'form', text: result.error });
      return;
    }
    if (!result.changed) return;
    const name = cleanTypeName(draft);
    if (!applyToLatest((types) => addMealType(types, name))) return;
    setDraft('');
    setError(null);
    announce(`${name} додано`);
  };

  /** `keepEditing`: Enter keeps a refused name in the field to fix; a blur puts the stored name back. */
  const rename = (key: number, from: string, keepEditing: boolean) => {
    const text = drafts[key];
    if (text === undefined) return;
    const result = renameMealType(mealTypes, from, text);
    if (!result.ok) {
      setError({ at: 'row', key, text: result.error });
      if (!keepEditing) dropDraft(key);
      return;
    }
    dropDraft(key);
    if (rowError(key)) setError(null);
    if (!result.changed) return;
    const to = cleanTypeName(text);
    if (!applyToLatest((types) => renameMealType(types, from, to))) return;
    setRowKeys((k) => renameTypeRow(k, from, to));
    setError(null);
    announce(`${from} → ${to}`);
  };

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>, key: number, name: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      rename(key, name, true);
    } else if (e.key === 'Escape') {
      // Only the field reverts: nothing around it (a sheet, a dialog) closes on this Escape.
      e.preventDefault();
      e.stopPropagation();
      dropDraft(key);
      if (rowError(key)) setError(null);
    }
  };

  const move = (key: number, name: string, index: number, dir: -1 | 1) => {
    const atEnd = dir === -1 ? index === 0 : index === rows.length - 1;
    if (atEnd || !moveMealType(mealTypes, name, dir).changed) return;
    if (!applyToLatest((types) => moveMealType(types, name, dir))) return;
    pendingFocus.current = { control: dir === -1 ? 'up' : 'down', key };
    setError(null);
    announce(`${name} — ${dir === -1 ? 'вище' : 'нижче'}`);
  };

  const remove = (key: number, name: string, index: number) => {
    if (!removeMealType(mealTypes, name).changed) return;
    if (!applyToLatest((types) => removeMealType(types, name))) return;
    // The ✕ goes away with its row: the next row's ✕ (or the previous one), the add field after the last one.
    const next = rows[index + 1] ?? rows[index - 1];
    pendingFocus.current = next ? { control: 'remove', key: next.key } : { control: 'add' };
    if (rows.length === 1) setEditing(false);
    dropDraft(key);
    setError(null);
    announce(`${name} видалено`);
  };

  const restore = () => {
    const result = restoreDefaultMealTypes(mealTypes);
    if (!result.ok) {
      setError({ at: 'form', text: result.error });
      return;
    }
    if (!result.changed) return;
    const added = result.types.slice(mealTypes.length);
    if (!applyToLatest(restoreDefaultMealTypes)) return;
    // The button goes away once every default is back: the add field above it takes the focus.
    if (!missingDefaults(result.types).length) pendingFocus.current = { control: 'add' };
    setError(null);
    announce(`Повернуто: ${added.join(', ')}`);
  };

  const formError = error?.at === 'form' ? error : null;

  return (
    <>
      <Card as="section" aria-label="Мої прийоми їжі">
        <div className={s.head}>
          <p id={introId} className={s.intro}>
            {MEAL_TYPES_INTRO}
          </p>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              className={s.toggle}
              aria-pressed={editingNow}
              onClick={() => {
                setEditing(!editingNow);
                setError(null);
              }}
            >
              {editingNow ? 'Готово' : 'Змінити'}
            </Button>
          )}
        </div>
        {rows.length > 0 && (
          <ol ref={listRef} className={s.list} aria-labelledby={introId}>
            {rows.map((row, i) => {
              if (!editingNow) {
                return (
                  <li key={row.key} className={s.row}>
                    {row.name}
                  </li>
                );
              }
              const shown = rowError(row.key);
              const first = i === 0;
              const last = i === rows.length - 1;
              return (
                <li key={row.key} className={s.editRow}>
                  <input
                    className={s.name}
                    value={drafts[row.key] ?? row.name}
                    aria-label={`Назва: ${row.name}`}
                    maxLength={LIMITS.mealTypeName}
                    autoComplete="off"
                    autoCapitalize="sentences"
                    enterKeyHint="done"
                    aria-invalid={shown && drafts[row.key] !== undefined ? true : undefined}
                    aria-describedby={shown ? errorId : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((d) => ({ ...d, [row.key]: value }));
                    }}
                    onBlur={() => rename(row.key, row.name, false)}
                    onKeyDown={(e) => onNameKeyDown(e, row.key, row.name)}
                  />
                  <IconButton
                    data-control={`${row.key}:up`}
                    className={s.control}
                    label={`Вище: ${row.name}`}
                    aria-disabled={first ? true : undefined}
                    onClick={() => move(row.key, row.name, i, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    data-control={`${row.key}:down`}
                    className={s.control}
                    label={`Нижче: ${row.name}`}
                    aria-disabled={last ? true : undefined}
                    onClick={() => move(row.key, row.name, i, 1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    data-control={`${row.key}:remove`}
                    className={s.control}
                    label={`Видалити «${row.name}»`}
                    onClick={() => remove(row.key, row.name, i)}
                  >
                    ✕
                  </IconButton>
                  {shown && (
                    <p id={errorId} className={s.rowError} role="alert">
                      {shown.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <form className={s.form} onSubmit={add} noValidate>
          <label htmlFor={inputId} className="visually-hidden">
            {NEW_MEAL_TYPE_LABEL}
          </label>
          <input
            ref={addInput}
            id={inputId}
            className={s.input}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (formError) setError(null);
            }}
            placeholder={NEW_MEAL_TYPE_LABEL}
            maxLength={LIMITS.mealTypeName}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="done"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? errorId : undefined}
          />
          <Button type="submit" disabled={!draft.trim()}>
            Додати
          </Button>
        </form>
        {formError && (
          <p id={errorId} className={s.error} role="alert">
            {formError.text}
          </p>
        )}
        {missing.length > 0 && (
          <Button variant="ghost" className={s.restore} onClick={restore}>
            Повернути стандартні
          </Button>
        )}
        <p role="status" className="visually-hidden">
          <span key={status.seq}>{status.text}</span>
        </p>
      </Card>
      <p className={s.note}>{mealTypesNote(mealTypes)}</p>
    </>
  );
}

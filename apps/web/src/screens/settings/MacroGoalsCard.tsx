import { useId, useState, type FormEvent } from 'react';
import { MACRO_KEYS, type MacroGoals, type MacroKey } from '@legko/shared';
import { MACRO_LABELS } from '@/lib/nutrition';
import { dataActions } from '@/store/data';
import { Card } from '@/ui';
import { MACRO_GOAL_ERROR, macroGoalText, parseMacroGoal } from './model';
import s from './MacroGoalsCard.module.css';

export interface MacroGoalsCardProps {
  goals: MacroGoals;
  /** Level of the card title: `h2` on the phone sub-page (under its <h1>), `h3` in the desktop pane. */
  headingLevel: 'h2' | 'h3';
}

export const MACRO_GOALS_NOTE = 'Порожнє поле — без цілі.';

/**
 * «Б · Ж · В на день» (Налаштування → Цілі, docs/meals-macros.md §7.11): optional daily goals for protein, fat and
 * carbs in whole grams. Each field saves on blur and on Enter; empty = no goal; anything but 1–1 000 is refused with
 * an inline error and nothing is saved.
 */
export function MacroGoalsCard({ goals, headingLevel: Heading }: MacroGoalsCardProps) {
  const noteId = useId();
  return (
    <Card as="section" gap={12} aria-label="Цілі: білки, жири, вуглеводи">
      <Heading className={s.title}>Б · Ж · В на день</Heading>
      {MACRO_KEYS.map((macro) => (
        <MacroGoalRow key={macro} macro={macro} goal={goals[macro]} noteId={noteId} />
      ))}
      <p id={noteId} className={s.note}>
        {MACRO_GOALS_NOTE}
      </p>
    </Card>
  );
}

interface MacroGoalRowProps {
  macro: MacroKey;
  goal: number | null;
  noteId: string;
}

/** One goal: label, grams field, «г». Its own form, so Enter saves it. */
function MacroGoalRow({ macro, goal, noteId }: MacroGoalRowProps) {
  const id = useId();
  const inputId = `${id}input`;
  const errorId = `${id}error`;
  const label = MACRO_LABELS[macro];
  const [text, setText] = useState(() => macroGoalText(goal));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  /** The goal the field was last filled from: a change elsewhere (sync) refills it, unless she is in the field. */
  const [shownGoal, setShownGoal] = useState(goal);
  if (!focused && goal !== shownGoal) {
    setShownGoal(goal);
    setText(macroGoalText(goal));
    setError(null);
  }

  const save = () => {
    const value = parseMacroGoal(text);
    if (value === 'invalid') {
      setError(MACRO_GOAL_ERROR);
      return;
    }
    setError(null);
    setText(macroGoalText(value));
    // Unchanged by her (only focused, or typed the same number): never write it over a change from elsewhere.
    if (value === shownGoal) return;
    setShownGoal(value);
    if (value === goal) return;
    dataActions.updateSettings((st) => ({ ...st, macroGoals: { ...st.macroGoals, [macro]: value } }));
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save();
  };

  return (
    <form className={s.row} onSubmit={submit} noValidate>
      <label htmlFor={inputId} className={s.label}>
        {label.name}
      </label>
      <span className={s.field}>
        <input
          id={inputId}
          className={s.input}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={5}
          placeholder="—"
          aria-label={`Ціль: ${label.lower}, г на день`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${noteId}` : noteId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            save();
          }}
        />
        <span className={s.unit} aria-hidden="true">
          г
        </span>
      </span>
      {error && (
        <p id={errorId} className={s.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

import type { FoodEstimateItem, FoodItem, Op } from '@legko/shared';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { commit as commitOps, useAppData } from '@/store/data';
import { cx } from '@/ui';
import { focusFirst, neighbourControls } from './focus';
import { buildFrequentDishes, chipAddLabel } from './model';
import s from './FrequentDishes.module.css';

export interface FrequentDishesProps {
  /**
   * A chip was tapped: the dish (its portion, kcal and macros — null where it has none) becomes a
   * position of the meal. Its `food.use` is recorded when the meal is saved — never here, so a
   * discarded draft counts nothing.
   */
  onAdd: (dish: FoodEstimateItem) => void;
  /** Injected in tests; defaults to the app data store. */
  foods?: readonly FoodItem[];
  /** Commits `food.delete` («Змінити» → ✕); `false` = refused, nothing removed. */
  commit?: (...ops: Op[]) => boolean;
  /** Id of the line that says why no dish can be added (30 positions): the chips are locked and described by it. */
  lockedBy?: string;
}

/** Where focus goes after a dish is deleted (resolved once the list re-renders). */
interface AfterRemove {
  key: string;
  index: number;
  /** Nearest control before the block, for when the last dish is gone (and the block with it). */
  fallback: HTMLElement[];
}

/**
 * «Часті страви»: one-tap chips of the most used dishes («Вівсянка з бананом · 320»), each adding a
 * position to the meal. Works offline. «Змінити» switches the chips to delete mode (✕).
 */
export function FrequentDishes({ onAdd, foods, commit = commitOps, lockedBy }: FrequentDishesProps) {
  const appFoods = useAppData().foods;
  const source = foods ?? appFoods;
  const dishes = useMemo(() => buildFrequentDishes(source), [source]);
  const [editing, setEditing] = useState(false);
  const labelId = useId();
  const blockRef = useRef<HTMLDivElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const afterRemove = useRef<AfterRemove | null>(null);

  // A deleted chip takes focus with it: move it to the next chip (or the previous one), and when
  // the last dish is gone, to the control before the block — never to <body>.
  useLayoutEffect(() => {
    const pending = afterRemove.current;
    if (!pending) return;
    afterRemove.current = null;
    if (dishes.some((d) => d.key === pending.key)) return;
    const next = dishes[pending.index] ?? dishes[pending.index - 1];
    focusFirst(next ? [removeButtons.current.get(next.key)] : pending.fallback);
  });

  if (!dishes.length) return null;

  const remove = (key: string, name: string, index: number) => {
    const fallback = blockRef.current ? neighbourControls(blockRef.current, 'before') : [];
    if (commit({ kind: 'food.delete', name }) === false) return;
    afterRemove.current = { key, index, fallback };
    if (dishes.length === 1) setEditing(false);
  };

  return (
    <div ref={blockRef} className={s.block}>
      <div className={s.head}>
        <span id={labelId} className={s.label}>
          Часті страви
        </span>
        <button
          type="button"
          className={s.edit}
          aria-pressed={editing}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Готово' : 'Змінити'}
        </button>
      </div>
      <ul className={s.chips} aria-labelledby={labelId}>
        {dishes.map((d, i) => (
          <li key={d.key} className={s.chipItem}>
            {editing ? (
              <button
                ref={(el) => {
                  if (el) removeButtons.current.set(d.key, el);
                  else removeButtons.current.delete(d.key);
                }}
                type="button"
                className={cx(s.chip, s.removing)}
                aria-label={`Видалити «${d.item.name}» з частих страв`}
                onClick={() => remove(d.key, d.item.name, i)}
              >
                <ChipText label={d.label} />
                <span className={s.x} aria-hidden="true">
                  ✕
                </span>
              </button>
            ) : (
              <button
                type="button"
                className={s.chip}
                aria-label={chipAddLabel(d.item)}
                aria-disabled={lockedBy !== undefined || undefined}
                aria-describedby={lockedBy}
                onClick={() => {
                  if (lockedBy === undefined) onAdd(d.item);
                }}
              >
                <ChipText label={d.label} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Name in ink, «· 320» in muted. */
function ChipText({ label }: { label: string }) {
  const cut = label.lastIndexOf(' · ');
  if (cut < 0) return <span>{label}</span>;
  return (
    <span>
      {label.slice(0, cut)}
      <span className={s.kcal}>{label.slice(cut)}</span>
    </span>
  );
}

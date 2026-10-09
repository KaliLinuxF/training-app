import type { FoodEstimateItem, FoodItem, ISODate, Op } from '@legko/shared';
import { useId, useMemo, useState } from 'react';
import { commit as commitOps, useAppData } from '@/store/data';
import { cx } from '@/ui';
import { buildFoodAdd, buildFrequentDishes } from './model';
import type { FoodAdd } from './types';
import s from './FrequentDishes.module.css';

export interface FrequentDishesProps {
  date: ISODate;
  onAdd: (add: FoodAdd) => void;
  /** Injected in tests; defaults to the app data store. */
  foods?: readonly FoodItem[];
  commit?: (...ops: Op[]) => void;
}

/** Ops recording that dishes were eaten on `date` (they feed «Часті страви»). */
export const foodUseOps = (date: ISODate, items: readonly FoodEstimateItem[]): Op[] =>
  items.map((it) => ({ kind: 'food.use', date, value: { name: it.name, portion: it.portion, kcal: it.kcal } }));

/**
 * «Часті страви»: one-tap chips of the most used dishes («Вівсянка з бананом · 320»). Works offline.
 * «Змінити» switches the chips to delete mode (✕).
 */
export function FrequentDishes({ date, onAdd, foods, commit = commitOps }: FrequentDishesProps) {
  const appFoods = useAppData().foods;
  const source = foods ?? appFoods;
  const dishes = useMemo(() => buildFrequentDishes(source), [source]);
  const [editing, setEditing] = useState(false);
  const labelId = useId();

  if (!dishes.length) return null;

  const add = (item: FoodEstimateItem) => {
    onAdd(buildFoodAdd([item], null));
    commit(...foodUseOps(date, [item]));
  };
  const remove = (name: string) => {
    commit({ kind: 'food.delete', name });
    if (dishes.length === 1) setEditing(false);
  };

  return (
    <div className={s.block}>
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
        {dishes.map((d) => (
          <li key={d.key} className={s.chipItem}>
            {editing ? (
              <button
                type="button"
                className={cx(s.chip, s.removing)}
                aria-label={`Видалити «${d.item.name}» з частих страв`}
                onClick={() => remove(d.item.name)}
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
                aria-label={`Додати ${d.label} ккал`}
                onClick={() => add(d.item)}
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

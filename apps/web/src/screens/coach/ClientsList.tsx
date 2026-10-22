import { useId } from 'react';
import { cx, ListGroup, ListRow } from '@/ui';
import { COACH_COPY, sortOptionLabel } from './copy';
import { SORT_FIRST_DIR, SORT_KEYS, isSortKey, type ClientRowModel, type SortState } from './clientsModel';
import { FlagPills } from './FlagPills';
import s from './ClientsList.module.css';

export interface ClientsListProps {
  rows: readonly ClientRowModel[];
}

/**
 * The phone clients list (docs/coach-cabinet.md §6.2): one link row per client (name, current weight, a
 * period-aware line) with the pills under it, outside the link and tied to it with `aria-describedby`. The sort
 * select sits in the toolbar next to the 7 / 30 switch (`SortSelect`).
 */
export function ClientsList({ rows }: ClientsListProps) {
  const pillsId = useId();
  if (rows.length === 0) return null;
  return (
    <ListGroup aria-label={COACH_COPY.title}>
      {rows.map((row) => {
        const describedBy = row.pills.length > 0 ? `${pillsId}-${row.id}` : undefined;
        return (
          <ListRow
            key={row.id}
            href={row.href}
            title={row.username}
            value={row.phone.value}
            valueTone={row.phone.value === '—' ? 'faint' : undefined}
            sub={row.phone.sub}
            aria-describedby={describedBy}
          >
            {describedBy && <FlagPills id={describedBy} pills={row.pills} className={s.pills} />}
          </ListRow>
        );
      })}
    </ListGroup>
  );
}

export interface SortSelectProps {
  sort: SortState;
  /** A key with its first direction (`SORT_FIRST_DIR`), or null for the default order. */
  onSortChange: (sort: SortState) => void;
  className?: string;
}

const ATTENTION = 'attention';

/**
 * «Сортування» of the phone list: a native 16px select with short options (it shares a row with the 7 / 30 switch
 * down to 320px). The label is for screen readers; the selected option says what it does.
 */
export function SortSelect({ sort, onSortChange, className }: SortSelectProps) {
  const selectId = useId();
  return (
    <div className={cx(s.sort, className)}>
      <label htmlFor={selectId} className="visually-hidden">
        {COACH_COPY.sortLabel}
      </label>
      <select
        id={selectId}
        className={s.select}
        value={sort.sort ?? ATTENTION}
        onChange={(e) => {
          const value = e.target.value;
          onSortChange(isSortKey(value) ? { sort: value, dir: SORT_FIRST_DIR[value] } : { sort: null, dir: 'asc' });
        }}
      >
        <option value={ATTENTION}>{sortOptionLabel(ATTENTION)}</option>
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {sortOptionLabel(key)}
          </option>
        ))}
      </select>
    </div>
  );
}

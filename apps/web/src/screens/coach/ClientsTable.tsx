import type { CoachPeriod, MacroKey } from '@legko/shared';
import { useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { backState, cx, ProgressBar } from '@/ui';
import { columnLabels, tableCaption } from './copy';
import { SORT_KEYS, type ClientRowModel, type SortKey, type SortState } from './clientsModel';
import { FlagPills } from './FlagPills';
import { COACH_ROOT } from './nav';
import { useScrollEdges } from './useScrollEdges';
import s from './ClientsTable.module.css';
import t from './tones.module.css';

export interface ClientsTableProps {
  rows: readonly ClientRowModel[];
  period: CoachPeriod;
  sort: SortState;
  /** A header was activated: the screen cycles the sort (`nextSort`). */
  onSort: (key: SortKey) => void;
}

const MACRO_LETTER: Readonly<Record<MacroKey, string>> = { protein: 'Б', fat: 'Ж', carbs: 'В' };

const ariaSort = (sort: SortState, key: SortKey): 'ascending' | 'descending' | 'none' =>
  sort.sort === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

/** Short text for sighted users, the long form for screen readers. */
function Both({ short, long, className }: { short: ReactNode; long: string; className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={className}>
        {short}
      </span>
      <span className="visually-hidden">{long}</span>
    </>
  );
}

/**
 * The desktop clients table (docs/coach-cabinet.md §6.1): 9 sortable columns, a sticky header row and a sticky name
 * column inside its own scrolling region (both axes), so the page never scrolls sideways. The name is the link; a
 * plain click anywhere else on the row opens the client too («Row clicks», §5.1). When the region is narrower than
 * the table, a fade on the right says more columns follow, and a shadow on the name column says some slid under it.
 */
export function ClientsTable({ rows, period, sort, onSort }: ClientsTableProps) {
  const captionId = useId();
  const [, navigate] = useLocation();
  const labels = columnLabels(period);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scrollerRef);

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('a,button')) return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    navigate(href, { state: backState(COACH_ROOT) });
  };

  // Enter on a header button sorts at once (and stops the native click that would sort a second time).
  const onHeaderKey = (e: KeyboardEvent<HTMLButtonElement>, key: SortKey) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSort(key);
  };

  return (
    <div className={cx(s.surface, edges.start && s.scrolled, edges.end && s.more)}>
      <div ref={scrollerRef} className={s.scroller} role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className={s.table}>
          <caption id={captionId} className="visually-hidden">
            {tableCaption(period)}
          </caption>
          <thead>
            <tr>
              {SORT_KEYS.map((key) => {
                const label = labels[key];
                const state = ariaSort(sort, key);
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={state}
                    className={cx(s.th, key === 'name' ? s.corner : s.num, s[`col_${key}`])}
                    title={label.title}
                  >
                    <button
                      type="button"
                      className={s.sortButton}
                      onClick={() => onSort(key)}
                      onKeyDown={(e) => onHeaderKey(e, key)}
                    >
                      <span className={s.headText}>
                        <span>{label.label}</span>
                        {label.sub && <span className={s.headSub}>{label.sub}</span>}
                      </span>
                      <span className={cx(s.glyph, state === 'none' && s.glyphOff)} aria-hidden="true">
                        {state === 'descending' ? '▼' : '▲'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} onClick={onRowClick} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  onClick,
}: {
  row: ClientRowModel;
  onClick: (e: MouseEvent<HTMLTableRowElement>, href: string) => void;
}) {
  const { cells } = row;
  return (
    <tr className={s.row} onClick={(e) => onClick(e, row.href)}>
      <th scope="row" className={s.nameCell}>
        <span className={s.nameStack}>
          <Link href={row.href} state={backState(COACH_ROOT)} className={s.name}>
            {row.username}
          </Link>
          <FlagPills pills={row.pills} />
        </span>
      </th>
      <td className={s.num}>
        <Both short={cells.weight.text} long={cells.weight.long} className={cells.weight.text === '—' ? t.faint : undefined} />
        {cells.weight.sub && (
          <span
            aria-hidden="true"
            className={cx(s.second, t[cells.weight.sub.tone === 'ink' ? 'muted' : cells.weight.sub.tone])}
          >
            {cells.weight.sub.text}
          </span>
        )}
      </td>
      <td className={s.num}>
        <Both short={cells.change.text} long={cells.change.long} className={t[cells.change.tone]} />
      </td>
      <td className={s.num}>
        <span className={s.goal}>
          <Both
            short={cells.goalPct.text}
            long={cells.goalPct.long}
            className={cells.goalPct.pct === null ? t.faint : undefined}
          />
          {cells.goalPct.pct !== null && (
            <ProgressBar value={cells.goalPct.pct} size="sm" tone="acc" className={s.bar} />
          )}
        </span>
      </td>
      <td className={s.num}>
        <span aria-hidden="true">
          <span className={t[cells.kcal.tone]}>{cells.kcal.text}</span>
          {cells.kcal.goal && <span className={t.muted}>{cells.kcal.goal}</span>}
        </span>
        {cells.kcal.macros && (
          <span aria-hidden="true" className={cx(s.second, s.macros, t.muted)}>
            {cells.kcal.macros.map((m, i) => (
              <span key={m.key}>
                {i > 0 && ' '}
                <span className={s.macro}>
                  {i > 0 && '· '}
                  {MACRO_LETTER[m.key]} <span className={m.tone === 'acc' ? t.acc : t.ink}>{m.text}</span>
                  {m.goal}
                </span>
              </span>
            ))}
          </span>
        )}
        <span className="visually-hidden">{cells.kcal.long}</span>
      </td>
      <td className={s.num}>
        <Both short={cells.workouts.text} long={cells.workouts.long} className={t[cells.workouts.tone]} />
      </td>
      <td className={s.num}>
        <Both
          short={
            <>
              <span className={t[cells.steps.tone]}>{cells.steps.text}</span>
              {cells.steps.goal && <span className={t.muted}>{cells.steps.goal}</span>}
            </>
          }
          long={cells.steps.long}
        />
      </td>
      <td className={s.num}>
        <Both short={cells.logged.text} long={cells.logged.long} />
      </td>
      <td className={cx(s.num, cells.activity.tone === 'faint' && t.faint)}>{cells.activity.text}</td>
    </tr>
  );
}

import { COACH_PERIODS, type CoachPeriod } from '@legko/shared';
import { useId, useMemo } from 'react';
import { Link, Redirect, useSearch } from 'wouter';
import { useIsDesktop } from '@/lib/platform';
import { Card, Chip, ChipGroup, cx, ScreenHeader, Segmented } from '@/ui';
import {
  allChip,
  attentionChip,
  COACH_COPY,
  countLine,
  nobodyFound,
  periodLabel,
  shownCount,
  tableNote,
} from './copy';
import {
  buildClientRows,
  filterRows,
  listSearch,
  nextSort,
  parseListParams,
  sortRows,
  type ListParams,
  type SortKey,
  type SortState,
} from './clientsModel';
import { ClientsList, SortSelect } from './ClientsList';
import { ClientsTable } from './ClientsTable';
import { LoadState } from './LoadState';
import { COACH_ROOT, useReplaceParams } from './nav';
import { useCoachClients, useNow } from './useCoachData';
import s from './ClientsScreen.module.css';

const PERIOD_OPTIONS = COACH_PERIODS.map((p) => ({ value: String(p) as `${CoachPeriod}`, label: periodLabel(p) }));

/** Where the «no clients yet» state sends the admin. */
export const USERS_PAGE = '/settings/users';

/**
 * «Клієнти» (`/coach`, admins only; docs/coach-cabinet.md §6.1–6.2, §6.8): every client with their numbers and
 * attention flags — a sortable table on the desktop, a list on the phone. Search, filter, period and sort live in the
 * URL (replaced, keeping the entry's state). Read-only: nothing here changes a client.
 */
export function ClientsScreen() {
  const { state, reload } = useCoachClients();
  const now = useNow();
  const search = useSearch();
  const params = useMemo(() => parseListParams(search), [search]);
  const replace = useReplaceParams();
  const isDesktop = useIsDesktop();
  const searchId = useId();

  const clients = state.status === 'ready' ? state.value.clients : null;
  const all = useMemo(
    () => (clients ? buildClientRows(clients, now, params.days) : []),
    [clients, now, params.days],
  );
  const attention = all.filter((row) => row.flags.length > 0).length;
  const shown = useMemo(
    () => sortRows(filterRows(all, params.show, params.q), params.sort, params.dir),
    [all, params.show, params.q, params.sort, params.dir],
  );

  if (state.status === 'forbidden') return <Redirect to="/" replace />;

  const set = (patch: Partial<ListParams>) => replace(`${COACH_ROOT}${listSearch({ ...params, ...patch })}`);
  const sortState: SortState = { sort: params.sort, dir: params.dir };
  const onSort = (key: SortKey) => set(nextSort(sortState, key));

  return (
    <div className={s.page}>
      <ScreenHeader
        subtitle={clients ? countLine(all.length, attention) : undefined}
        title={COACH_COPY.title}
      />

      {state.status === 'loading' && <LoadState kind="loading" onRetry={reload} />}
      {state.status === 'error' && <LoadState kind={state.offline ? 'offline' : 'error'} onRetry={reload} />}

      {clients && all.length === 0 && <NoClients />}

      {clients && all.length > 0 && (
        <>
          <div className={s.toolbar}>
            <div className={s.search}>
              <label htmlFor={searchId} className="visually-hidden">
                {COACH_COPY.searchLabel}
              </label>
              <input
                id={searchId}
                type="search"
                className={s.input}
                placeholder={COACH_COPY.searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                value={params.q}
                onChange={(e) => set({ q: e.target.value })}
              />
            </div>
            <ChipGroup aria-label={COACH_COPY.filtersLabel} className={s.chips}>
              <Chip selected={params.show === 'attention'} onClick={() => set({ show: 'attention' })}>
                {attentionChip(attention)}
              </Chip>
              <Chip selected={params.show === 'all'} onClick={() => set({ show: 'all' })}>
                {allChip(all.length)}
              </Chip>
            </ChipGroup>
            {/* Phone: the 7 / 30 switch and the sort share one row; desktop: the switch alone, on the right. */}
            <div className={s.controls}>
              <Segmented
                aria-label={COACH_COPY.periodLabel}
                className={s.period}
                options={PERIOD_OPTIONS}
                value={String(params.days) as `${CoachPeriod}`}
                onChange={(v) => set({ days: Number(v) as CoachPeriod })}
              />
              {!isDesktop && <SortSelect className={s.sort} sort={sortState} onSortChange={(next) => set(next)} />}
            </div>
          </div>

          {!isDesktop && <ClientsList rows={shown} />}
          {isDesktop && shown.length > 0 && (
            <ClientsTable rows={shown} period={params.days} sort={sortState} onSort={onSort} />
          )}

          {shown.length === 0 && (
            <Card as="section" className={s.empty}>
              <p className={s.emptyText}>
                {params.q.trim() !== '' ? nobodyFound(params.q.trim()) : COACH_COPY.noneNeedAttention}
              </p>
            </Card>
          )}

          <p className={cx(s.count, shown.length === all.length && 'visually-hidden')} aria-live="polite">
            {shownCount(shown.length, all.length)}
          </p>
          <p className={s.note}>{tableNote(params.days)}</p>
        </>
      )}
    </div>
  );
}

/** «Клієнтів ще немає» + where to invite someone. */
function NoClients() {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} className={s.empty}>
      <h2 id={titleId} className={s.emptyTitle}>
        {COACH_COPY.noClients}
      </h2>
      <p className={s.emptyText}>{COACH_COPY.noClientsText}</p>
      <Link href={USERS_PAGE} className={s.usersLink}>
        {COACH_COPY.openUsers}
      </Link>
    </Card>
  );
}

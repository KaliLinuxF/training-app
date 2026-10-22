import {
  clientToday,
  coachItemFromData,
  coachSummary,
  coachWindow,
  COACH_PERIODS,
  type CoachClientResponse,
  type CoachPeriod,
} from '@legko/shared';
import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { Link, Redirect, useParams, useSearch } from 'wouter';
import { PhotoUrlsProvider } from '@/lib/photoUrls';
import { useIsDesktop } from '@/lib/platform';
import { Card, cx, Pill, ScreenHeader, Segmented } from '@/ui';
import { CalendarPanel } from './CalendarPanel';
import { detailHref, parseDetailParams, TABS, type DetailParams } from './clientModel';
import { neverSeenFlagged, pillsOf } from './clientsModel';
import {
  COACH_COPY,
  goalsLine,
  headerSubtitle,
  periodLabel,
  TAB_LABELS,
  type CoachTab,
} from './copy';
import { FlagPills } from './FlagPills';
import { LoadState } from './LoadState';
import { coachPhotoUrls, COACH_ROOT, useReplaceParams } from './nav';
import { NutritionPanel } from './NutritionPanel';
import { OverviewPanel } from './OverviewPanel';
import { ProgressPanel } from './ProgressPanel';
import { useCoachClient, useNow } from './useCoachData';
import { scrollLeftToReveal, useScrollEdges } from './useScrollEdges';
import s from './ClientScreen.module.css';

const BACK = { href: COACH_ROOT, label: COACH_COPY.backLabel } as const;
const PERIOD_OPTIONS = COACH_PERIODS.map((p) => ({ value: String(p) as `${CoachPeriod}`, label: periodLabel(p) }));

/**
 * One client, read-only (`/coach/<id>`, admins only; docs/coach-cabinet.md §6.3–6.7): the header (since, activity,
 * goals, flags, «Лише перегляд»), the four tabs and the panel of the selected tab. Photos come through the coach
 * route (`PhotoUrlsProvider`). Every tab / period / day change replaces the entry and keeps its back stamp, so
 * «‹ Клієнти» returns to the list with its filters.
 */
export function ClientScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const { state, reload } = useCoachClient(id);
  const urls = useMemo(() => coachPhotoUrls(id), [id]);

  if (state.status === 'forbidden') return <Redirect to="/" replace />;

  return (
    <PhotoUrlsProvider value={urls}>
      {state.status === 'ready' ? (
        <ClientPage id={id} response={state.value} />
      ) : state.status === 'notFound' ? (
        <>
          <ScreenHeader back={BACK} title={COACH_COPY.notFound} />
          <Card as="section" aria-label={COACH_COPY.notFound} className={s.state}>
            <p className={s.stateText}>{COACH_COPY.notFoundText}</p>
          </Card>
        </>
      ) : (
        <>
          <ScreenHeader back={BACK} title={COACH_COPY.clientFallback} />
          <LoadState
            kind={state.status === 'loading' ? 'loading' : state.offline ? 'offline' : 'error'}
            onRetry={reload}
          />
        </>
      )}
    </PhotoUrlsProvider>
  );
}

function ClientPage({ id, response }: { id: string; response: CoachClientResponse }) {
  const { client, data } = response;
  const now = useNow();
  const search = useSearch();
  const params = useMemo(() => parseDetailParams(search), [search]);
  const replace = useReplaceParams();
  const today = clientToday(data.settings.timezone, now);
  const summary = useMemo(
    () => coachSummary(coachItemFromData(client, data, coachWindow(now)), now, params.days),
    [client, data, now, params.days],
  );
  const set = (patch: Partial<DetailParams>) => replace(detailHref(id, { ...params, ...patch }));
  const showDays = params.tab === 'overview' || params.tab === 'nutrition';

  return (
    <>
      <div className={s.head}>
        <ScreenHeader
          back={BACK}
          className={s.header}
          subtitle={headerSubtitle(client, now, neverSeenFlagged(summary))}
          title={client.username}
          right={
            <Pill tone="neutral" className={s.readOnly}>
              {COACH_COPY.readOnly}
            </Pill>
          }
        />
        <p className={s.goals}>{goalsLine(data.settings)}</p>
        <FlagPills pills={pillsOf(summary)} onPaper className={s.pills} />
        <div className={s.bar}>
          <Tabs id={id} params={params} onSelect={(href) => replace(href)} />
          {showDays && (
            <Segmented
              aria-label={COACH_COPY.periodLabel}
              className={s.days}
              options={PERIOD_OPTIONS}
              value={String(params.days) as `${CoachPeriod}`}
              onChange={(v) => set({ days: Number(v) as CoachPeriod })}
            />
          )}
        </div>
      </div>

      {params.tab === 'overview' && <OverviewPanel data={data} today={today} summary={summary} now={now} />}
      {params.tab === 'progress' && <ProgressPanel clientId={id} data={data} today={today} params={params} />}
      {params.tab === 'calendar' && <CalendarPanel clientId={id} data={data} today={today} params={params} />}
      {params.tab === 'nutrition' && (
        <NutritionPanel clientId={id} data={data} today={today} params={params} />
      )}
    </>
  );
}

/**
 * «Огляд · Прогрес · Календар · Харчування» as links (each tab is a URL): a plain click replaces the entry keeping
 * its state; modified / middle clicks are left to the browser (wouter's Link skips them before `onClick`).
 */
function Tabs({ id, params, onSelect }: { id: string; params: DetailParams; onSelect: (href: string) => void }) {
  const isDesktop = useIsDesktop();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const edges = useScrollEdges(navRef);

  // Phone: when the strip is narrower than its tabs it scrolls inside itself; bring the selected tab into view by
  // scrolling the strip only (sideways) — never the page, as Element.scrollIntoView would.
  useEffect(() => {
    if (isDesktop) return;
    const nav = navRef.current;
    const tab = activeRef.current;
    if (!nav || !tab) return;
    const left = scrollLeftToReveal(nav, tab);
    if (left === null) return;
    if (typeof nav.scrollTo === 'function') nav.scrollTo({ left });
    else nav.scrollLeft = left;
  }, [isDesktop, params.tab]);

  const go = (e: MouseEvent, href: string) => {
    e.preventDefault();
    onSelect(href);
  };

  return (
    <nav
      ref={navRef}
      aria-label={COACH_COPY.tabsLabel}
      className={cx(s.tabs, edges.start && s.fadeStart, edges.end && s.fadeEnd)}
    >
      {TABS.map((tab: CoachTab) => {
        const href = detailHref(id, { ...params, tab });
        const active = tab === params.tab;
        return (
          <Link
            key={tab}
            href={href}
            replace
            ref={active ? activeRef : undefined}
            className={cx(s.tab, active && s.activeTab)}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => go(e, href)}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}

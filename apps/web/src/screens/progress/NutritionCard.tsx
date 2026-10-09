import { useEffect, useId, useRef } from 'react';
import { BarChart, Card, CardHeader, cx, Icon, Legend, LegendItem, StatStrip } from '@/ui';
import type { NutritionModel } from './model';
import s from './NutritionCard.module.css';

export interface NutritionCardProps extends NutritionModel {
  onShowMore: () => void;
  /** Opens a day from «Історія калорій» (`href` = its calendar route). */
  onOpenDay: (href: string) => void;
}

export const NO_KCAL_IN_PERIOD = 'За цей період калорій ще немає';
export const NO_KCAL_HISTORY = 'Ще немає днів із калоріями';
export const SHOW_MORE = 'Показати ще';

/** «Харчування»: average kcal of this week / month, the bar chart with the goal line and the kcal history. */
export function NutritionCard({
  goal,
  stats,
  bars,
  goalPct,
  gap,
  labeled,
  note,
  hasBarData,
  chartLabel,
  history,
  hasMore,
  onShowMore,
  onOpenDay,
}: NutritionCardProps) {
  const titleId = useId();
  const historyId = useId();
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** History length when «Показати ще» was pressed while it had focus (keyboard, VoiceOver), else null. */
  const revealFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = revealFrom.current;
    if (from === null) return;
    revealFrom.current = null;
    // While more days remain the button stays and keeps focus. On the last page it unmounts, so focus moves to
    // the first newly shown day instead of falling to <body>.
    if (hasMore) return;
    const rows = rowRefs.current.slice(0, history.length);
    (rows[from] ?? rows.at(-1))?.focus();
  }, [history.length, hasMore]);
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Харчування" titleId={titleId} meta={goal} align="baseline" />
      <StatStrip items={stats} columns={2} />
      <div className={s.chart}>
        <BarChart bars={bars} goalPct={goalPct} gap={gap} labeled={labeled} aria-label={chartLabel} />
        {!hasBarData && <p className={s.chartEmpty}>{NO_KCAL_IN_PERIOD}</p>}
      </div>
      <Legend>
        <LegendItem color="acc2" shape="square" label="У межах цілі" />
        <LegendItem color="acc" shape="square" label="Більше цілі" />
        {note && <span>{note}</span>}
      </Legend>
      <div className={s.history} role="group" aria-labelledby={historyId}>
        <h3 id={historyId} className={s.historyTitle}>
          Історія калорій
        </h3>
        {history.length === 0 && <p className={s.historyEmpty}>{NO_KCAL_HISTORY}</p>}
        {history.map((row, i) => (
          <button
            key={row.date}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            type="button"
            className={s.row}
            aria-label={row.ariaLabel}
            onClick={() => onOpenDay(row.href)}
          >
            {/* Spaces between the grid items are not drawn; they keep the text «Вт, 13 жовтня 1 740 ккал». */}
            <span className={s.date}>{row.label}</span>{' '}
            <span className={s.kcal}>
              <span className={cx(s.dot, row.tone === 'over' ? s.over : s.ok)} aria-hidden="true" />
              {row.value}
            </span>{' '}
            <Icon name="chevronRight" size={16} className={s.chevron} />
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            className={s.more}
            onClick={(e) => {
              // Only a focused button hands focus on (a Safari touch tap does not focus it: no stray ring).
              revealFrom.current = e.currentTarget === document.activeElement ? history.length : null;
              onShowMore();
            }}
          >
            {SHOW_MORE}
          </button>
        )}
      </div>
    </Card>
  );
}

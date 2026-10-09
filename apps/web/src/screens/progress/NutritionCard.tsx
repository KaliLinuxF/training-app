import { useId } from 'react';
import { BarChart, BarRow, Card, CardHeader, Legend, LegendItem, Tile } from '@/ui';
import type { NutritionModel } from './model';
import g from './grids.module.css';
import s from './NutritionCard.module.css';

export interface NutritionCardProps extends NutritionModel {
  onShowMore: () => void;
  /** Opens a day from «Історія калорій» (`href` = its calendar route). */
  onOpenDay: (href: string) => void;
}

export const NO_KCAL_IN_PERIOD = 'За цей період калорій ще немає';
export const NO_KCAL_HISTORY = 'Ще немає днів із калоріями';
export const SHOW_MORE = 'Показати ще';

/** «Харчування»: kcal averages, bar chart with the goal line and the browsable kcal history. */
export function NutritionCard({
  goal,
  tiles,
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
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Харчування" titleId={titleId} meta={goal} align="baseline" />
      <div className={g.tiles3}>
        {tiles.map((t) => (
          <Tile key={t.label} variant="compact" label={t.label} value={t.value} />
        ))}
      </div>
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
        {history.map((row) => (
          <BarRow
            key={row.date}
            variant="history"
            label={row.label}
            value={row.value}
            pct={row.pct}
            tone={row.tone}
            aria-label={row.ariaLabel}
            onClick={() => onOpenDay(row.href)}
          />
        ))}
        {hasMore && (
          <button type="button" className={s.more} onClick={onShowMore}>
            {SHOW_MORE}
          </button>
        )}
      </div>
    </Card>
  );
}

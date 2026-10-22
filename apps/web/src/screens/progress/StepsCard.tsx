import { useId } from 'react';
import { BarChart, Card, CardHeader, Legend, LegendItem, StatStrip } from '@/ui';
import type { StepsModel } from './model';
import s from './StepsCard.module.css';

export const NO_STEPS_IN_PERIOD = 'За цей період кроків ще немає';

/**
 * «Кроки» (shown once she logged steps at all): the period's average, the goal and the days that reached it, the
 * daily bars (weekly averages over 3 months / all time) with a goal line only when a goal is set, and the burned kcal
 * per day. Display only: the steps never change the calorie goal (W8).
 */
export function StepsCard({ stats, chart, burned }: StepsModel) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Кроки" titleId={titleId} />
      <StatStrip items={stats} columns={stats.length === 3 ? 3 : 2} />
      <div className={s.chart}>
        <BarChart
          bars={chart.bars}
          goalPct={chart.goalPct}
          gap={chart.gap}
          labeled={chart.labeled}
          aria-label={chart.label}
        />
        {!chart.hasData && <p className={s.chartEmpty}>{NO_STEPS_IN_PERIOD}</p>}
      </div>
      {chart.goalPct !== null && (
        <Legend>
          <LegendItem color="acc2" shape="square" label="Ціль виконано" />
        </Legend>
      )}
      {burned && <p className={s.burned}>{burned}</p>}
    </Card>
  );
}

import { useId } from 'react';
import { Card, CardHeader, cx, LineChart, Pill, ProgressBar } from '@/ui';
import { ChartPlaceholder, RECORD_WEIGHT } from './ChartPlaceholder';
import type { WeightModel } from './model';
import s from './WeightCard.module.css';

export interface WeightCardProps {
  weight: WeightModel;
  /** «+ Записати вагу» in the chart placeholder (opens «Контрольне зважування»). */
  onRecord?: () => void;
}

/**
 * «Вага»: the current weight with the all-time change («−2,9 кг від старту»), the way to the goal
 * (bar + «Старт 68,3 · ще 5,4 кг · Ціль 60,0», «35% шляху» in the header) and the weigh-in chart of the period.
 */
export function WeightCard({ weight, onRecord }: WeightCardProps) {
  const titleId = useId();
  const { current, change, start, goal, left, pct, pctLabel, chart } = weight;
  // `pctLabel` is '' only before the first weigh-in: then «—» stands alone, without «кг».
  const hasWeight = pctLabel !== '';
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader
        title="Вага"
        titleId={titleId}
        right={pctLabel ? <span className={s.way}>{pctLabel}</span> : undefined}
      />
      <div className={s.now}>
        <p className={s.current}>
          <span className="visually-hidden">Поточна вага: </span>
          <span className={cx(s.value, !hasWeight && s.none)}>{current}</span>
          {hasWeight && (
            <>
              {' '}
              <span className={s.unit}>кг</span>
            </>
          )}
        </p>
        {change && (
          <Pill size="md" tone={change.tone}>
            {change.text}
          </Pill>
        )}
      </div>
      <div className={s.progress}>
        <ProgressBar value={pct} size="sm" tone="acc" />
        <p className={s.scale}>
          <span>
            Старт <b className={s.num}>{start}</b>
          </span>{' '}
          <span className={s.left}>{left}</span>{' '}
          <span>
            Ціль <b className={s.num}>{goal}</b>
          </span>
        </p>
      </div>
      {chart.enough ? (
        <LineChart geometry={chart.geometry} height={120} aria-label={chart.ariaLabel} />
      ) : (
        <ChartPlaceholder
          hint={chart.emptyHint}
          action={onRecord ? { label: RECORD_WEIGHT, onClick: onRecord } : undefined}
        />
      )}
    </Card>
  );
}

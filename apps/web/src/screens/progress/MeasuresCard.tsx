import type { MeasureKey } from '@legko/shared';
import { useId } from 'react';
import { Card, CardHeader, cx, LineChart } from '@/ui';
import { ChartPlaceholder, RECORD_MEASURE } from './ChartPlaceholder';
import type { LineChartModel, MeasureRowModel } from './model';
import s from './MeasuresCard.module.css';
import t from './tones.module.css';

export interface MeasuresCardProps {
  rows: readonly MeasureRowModel[];
  chart: LineChartModel;
  /** «Талія, см» */
  chartLabel: string;
  onSelect: (key: MeasureKey) => void;
  /** «+ Записати заміри» in the chart placeholder (opens «Заміри тіла»). */
  onRecord?: () => void;
}

/** «Заміри тіла»: first → latest value per parameter; the selected row drives the chart. */
export function MeasuresCard({ rows, chart, chartLabel, onSelect, onRecord }: MeasuresCardProps) {
  const titleId = useId();
  return (
    <Card as="section" gap={12} aria-labelledby={titleId}>
      <CardHeader title="Заміри тіла" titleId={titleId} />
      <div className={s.rows} role="group" aria-label="Параметр для графіка">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            className={cx(s.row, row.selected && s.selected)}
            aria-pressed={row.selected}
            aria-label={row.ariaLabel}
            onClick={() => onSelect(row.key)}
          >
            {/* Spaces between the flex items are not drawn; they keep the text «Талія 74 → 70 см −4 см». */}
            <span className={s.label}>{row.label}</span>{' '}
            <span className={s.values}>
              <span className={s.range}>{row.range}</span>{' '}
              <span className={cx(s.delta, t[row.deltaTone])}>{row.delta}</span>
            </span>
          </button>
        ))}
      </div>
      {chart.enough ? (
        <LineChart
          geometry={chart.geometry}
          height={120}
          tone="acc2"
          showTag={false}
          middleLabel={chartLabel}
          aria-label={chart.ariaLabel}
        />
      ) : (
        <ChartPlaceholder
          hint={chart.emptyHint}
          action={onRecord ? { label: RECORD_MEASURE, onClick: onRecord } : undefined}
        />
      )}
    </Card>
  );
}

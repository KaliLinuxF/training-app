import { useId } from 'react';
import { Card, CardHeader, LineChart, Tile } from '@/ui';
import { ChartPlaceholder } from './ChartPlaceholder';
import type { LineChartModel, ValueCell } from './model';
import g from './grids.module.css';

export interface WeightCardProps {
  tiles: readonly ValueCell[];
  chart: LineChartModel;
}

/** «Вага»: start / current / goal / lost / left / way, and the weigh-in chart. */
export function WeightCard({ tiles, chart }: WeightCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Вага" titleId={titleId} />
      <div className={g.tiles3}>
        {tiles.map((t) => (
          <Tile key={t.label} variant="compact" label={t.label} value={t.value} tone={t.tone} />
        ))}
      </div>
      {chart.enough ? (
        <LineChart geometry={chart.geometry} height={150} aria-label={chart.ariaLabel} />
      ) : (
        <ChartPlaceholder height={150} hint={chart.emptyHint} />
      )}
    </Card>
  );
}

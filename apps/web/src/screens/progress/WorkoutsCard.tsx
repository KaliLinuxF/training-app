import { useId } from 'react';
import { BarRow, Card, CardHeader, Tile } from '@/ui';
import type { TypeBarModel, ValueCell } from './model';
import g from './grids.module.css';
import s from './WorkoutsCard.module.css';

export interface WorkoutsCardProps {
  tiles: readonly ValueCell[];
  /** «Найчастіше · цього тижня» */
  typesHeading: string;
  types: readonly TypeBarModel[];
}

export const NO_WORKOUTS = 'За цей період тренувань ще немає';

/** «Тренування»: counters and the most frequent workout types of the period. */
export function WorkoutsCard({ tiles, typesHeading, types }: WorkoutsCardProps) {
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader title="Тренування" titleId={titleId} />
      <div className={g.tiles2}>
        {tiles.map((t) => (
          <Tile key={t.label} variant="count" label={t.label} value={t.value} />
        ))}
      </div>
      <div className={s.types}>
        <h3 className={s.heading}>{typesHeading}</h3>
        {types.length > 0 ? (
          types.map((type) => (
            <BarRow key={type.label} variant="rank" label={type.label} value={type.value} pct={type.pct} />
          ))
        ) : (
          <p className={s.empty}>{NO_WORKOUTS}</p>
        )}
      </div>
    </Card>
  );
}

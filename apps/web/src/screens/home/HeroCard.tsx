import { useId } from 'react';
import { Card, Pill, ProgressBar, Tile } from '@/ui';
import type { HomeHero } from './homeModel';
import s from './HeroCard.module.css';

/** The dark «Поточна вага» card (Tracker.dc.html lines 54–70). */
export function HeroCard({ hero }: { hero: HomeHero }) {
  const labelId = useId();
  return (
    <Card variant="hero" as="section" aria-labelledby={labelId}>
      <div className={s.top}>
        <div className={s.current}>
          <h2 id={labelId} className={s.label}>
            Поточна вага
          </h2>
          <p className={s.valueRow}>
            <span className={s.value}>{hero.current}</span>
            <span className={s.unit}>кг</span>
          </p>
        </div>
        <Pill tone="accSolid" size="lg">
          {hero.badge}
        </Pill>
      </div>

      <div className={s.progress}>
        <ProgressBar value={hero.pct} track="onSolid" />
        <p className={s.scale}>
          <span>Старт {hero.start}</span>
          <span>{hero.pctLabel} шляху</span>
          <span>Ціль {hero.goal}</span>
        </p>
      </div>

      <div className={s.tiles}>
        <Tile variant="onSolid" label="Втрачено" value={hero.lost} />
        <Tile variant="onSolid" label="До цілі" value={hero.left} />
      </div>
    </Card>
  );
}

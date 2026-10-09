import { useId } from 'react';
import { Card, cx, Pill, ProgressBar } from '@/ui';
import type { HomeHero } from './homeModel';
import s from './HeroCard.module.css';

export interface HeroCardProps {
  hero: HomeHero;
  className?: string;
}

/**
 * The compact dark «Поточна вага» card: current weight + signed change badge, the progress bar and one line
 * «35% шляху · до цілі 5,4 кг». Not interactive; the visually hidden <h2> names the region.
 */
export function HeroCard({ hero, className }: HeroCardProps) {
  const titleId = useId();
  const weighed = hero.progress !== '';
  return (
    <Card variant="hero" as="section" aria-labelledby={titleId} className={cx(s.hero, className)}>
      <h2 id={titleId} className="visually-hidden">
        Поточна вага
      </h2>
      <div className={s.top}>
        <p className={s.valueRow}>
          {/* Before the first weigh-in «—» stands alone, muted, without «кг» (as on «Мій прогрес»). */}
          <span className={cx(s.value, !weighed && s.none)}>{hero.current}</span>
          {weighed && <span className={s.unit}>кг</span>}
        </p>
        {hero.badge !== null && (
          <Pill tone="accSolid" size="lg" className={s.badge}>
            <span className="visually-hidden">{hero.badgeSr}: </span>
            {hero.badge}
          </Pill>
        )}
      </div>

      <ProgressBar value={hero.pct} track="onSolid" />

      <p className={s.line}>
        {weighed ? (
          <>
            <span>
              <b className={s.num}>{hero.progress}</b> шляху
            </span>
            {hero.reached ? (
              <span className={s.reached}>✓ Ціль досягнута</span>
            ) : (
              <span>
                до цілі <b className={s.num}>{hero.left}</b>
              </span>
            )}
          </>
        ) : (
          <span>{hero.goal}</span>
        )}
      </p>
    </Card>
  );
}

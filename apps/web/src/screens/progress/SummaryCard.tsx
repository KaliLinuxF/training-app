import { Fragment, useId } from 'react';
import { Card, CardHeader, cx } from '@/ui';
import type { SummaryItem } from './model';
import s from './SummaryCard.module.css';
import t from './tones.module.css';

export interface SummaryCardProps {
  /** Period title: «Цього тижня», «За 3 місяці»… (the region's name). */
  title: string;
  items: readonly SummaryItem[];
}

/**
 * Lavender «Цього тижня» card: the period in one sentence (SPEC §1.1 #7 wording), not a table that repeats the
 * cards below — «Тренувань 2 · сер. калорійність 1 795 ккал · вага −0,3 кг · талія −0,5 см · …».
 */
export function SummaryCard({ title, items }: SummaryCardProps) {
  const titleId = useId();
  return (
    <Card as="section" variant="tint" full gap={8} aria-labelledby={titleId} className={s.card}>
      <CardHeader size="sm" title={title} titleId={titleId} />
      <p className={s.line}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={item.key}>
              {/*
               * The dot sits inside the nowrap item it follows, so it always ends a line — even after «—», which
               * allows a break after itself — and never starts one; the real space after it is the only break.
               */}
              <span className={s.item}>
                {item.label} <b className={cx(s.num, t[item.tone])}>{item.value}</b>
                {item.unit ? ` ${item.unit}` : ''}
                {!last && (
                  <span className={s.sep} aria-hidden="true">
                    ·
                  </span>
                )}
              </span>
              {!last && ' '}
            </Fragment>
          );
        })}
      </p>
    </Card>
  );
}

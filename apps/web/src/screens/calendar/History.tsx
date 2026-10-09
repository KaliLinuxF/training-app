import type { ISODate } from '@legko/shared';
import { Card, Pill, Section } from '@/ui';
import type { HistoryModel } from './model';
import s from './History.module.css';

export interface HistoryProps {
  history: HistoryModel;
  onOpen: (date: ISODate) => void;
  onMore: () => void;
}

/** «Останні записи» (prototype lines 191–206) with «Показати ще». */
export function History({ history, onOpen, onMore }: HistoryProps) {
  return (
    <Section title="Останні записи" gap={8} full>
      {history.rows.length ? (
        <Card variant="list" className={s.card}>
          <ul className={s.list}>
            {history.rows.map((r) => (
              <li key={r.date} className={s.item}>
                <button type="button" className={s.row} aria-label={r.label} onClick={() => onOpen(r.date)}>
                  <span className={s.badge}>
                    <span className={s.badgeDay}>{r.day}</span>
                    <span className={s.badgeMonth}>{r.month}</span>
                  </span>
                  <span className={s.text}>
                    <span className={s.kcal}>{r.kcal}</span>
                    <span className={s.food}>{r.food}</span>
                  </span>
                  <Pill size="sm" tone={r.trainingTone}>
                    {r.training}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
          {history.hasMore && (
            <button type="button" className={s.more} onClick={onMore}>
              Показати ще
            </button>
          )}
        </Card>
      ) : (
        <Card>
          <p className={s.empty}>Записів поки немає — заповни перший день, і він зʼявиться тут.</p>
        </Card>
      )}
    </Section>
  );
}

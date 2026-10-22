import type { AppData, ISODate } from '@legko/shared';
import { useMemo } from 'react';
import { PhotoStrip } from '@/features/food';
import { DayNutritionCard } from '@/sheets/record/DayNutritionCard';
import { ListGroup, ListRow, Pill } from '@/ui';
import { COACH_COPY } from './copy';
import { coachDayModel } from './dayViewModel';
import s from './CoachDayView.module.css';

export interface CoachDayViewProps {
  data: AppData;
  date: ISODate;
  /** The client's today. */
  today: ISODate;
}

const DASH = '—';

/**
 * One day of a client, read-only (docs/coach-cabinet.md §6.5): the date with its status, Тренування / Вага / Заміри /
 * Нотатки, the day's totals against the client's goals, and every meal with its own Б · Ж · В and photos (served
 * through the coach route by the page's `PhotoUrlsProvider`). Static rows only: no chevrons, no toggles, nothing that
 * adds or edits.
 */
export function CoachDayView({ data, date, today }: CoachDayViewProps) {
  const day = useMemo(() => coachDayModel(data, date, today), [data, date, today]);
  return (
    <div className={s.day}>
      <ListGroup
        titleSize="lg"
        title={day.title}
        subtitle={day.weekday}
        headerRight={<Pill tone={day.statusTone}>{day.statusLabel}</Pill>}
      >
        {day.empty ? (
          <ListRow title={COACH_COPY.emptyDay} />
        ) : (
          day.rows.map((row) => {
            const blank = row.value === null && row.text === null;
            return (
              <ListRow
                key={row.key}
                title={row.title}
                value={blank ? DASH : (row.value ?? undefined)}
                valueTone={blank ? 'faint' : row.valueTone === 'acc' ? 'acc' : undefined}
                valueVariant={blank ? 'soft' : 'strong'}
                sub={row.text ?? undefined}
                subWrap={row.key === 'notes' || row.key === 'measures' || row.key === 'training'}
              />
            );
          })
        )}
      </ListGroup>

      {day.totals && <DayNutritionCard totals={day.totals} />}

      {day.meals.length > 0 && (
        <ListGroup caption={COACH_COPY.meals}>
          {day.meals.map((meal) => {
            const sub = [meal.content, meal.macros].filter((part): part is string => !!part).join(' · ');
            return (
              <ListRow
                key={meal.id}
                title={meal.time ? `${meal.title} · ${meal.time}` : meal.title}
                value={meal.value}
                valueTone={meal.hasKcal ? undefined : 'faint'}
                sub={sub || undefined}
                subWrap
                aria-label={meal.label}
              >
                {meal.photos.length > 0 && <PhotoStrip ids={meal.photos} size="sm" />}
              </ListRow>
            );
          })}
        </ListGroup>
      )}
    </div>
  );
}

import { Fragment, useId } from 'react';
import { Link, useLocation } from 'wouter';
import type { ReminderKind, Reminders, WeeklyReminder } from '@legko/shared';
import { WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { dataActions, useAppData } from '@/store/data';
import { backState, Card, CardHeader, cx, Switch, TimeInput, WeekdayPicker } from '@/ui';
import {
  NOT_IN_PLAN,
  REMINDER_DAYS_LABELS,
  REMINDER_TITLES,
  reminderSubtitle,
  SCHEDULE_SENTENCE,
  withReminder,
  workoutSchedule,
} from './model';
import s from './ReminderCard.module.css';

export interface ReminderCardProps {
  kind: ReminderKind;
  rem: Reminders;
  /** `h2` under a page <h1> (phone), `h3` under the desktop pane's <h2>. */
  headingLevel?: 'h2' | 'h3';
}

type CommonPatch = Partial<Pick<WeeklyReminder, 'on' | 'time'>>;

/**
 * One reminder (Налаштування → Нагадування; prototype lines 365–383): title + switch, weekday picker, time.
 * Saves on every change.
 */
export function ReminderCard({ kind, rem, headingLevel = 'h2' }: ReminderCardProps) {
  const id = useId();
  const titleId = `${id}title`;
  const timeId = `${id}time`;
  const r = rem[kind];
  // The prototype keeps the controls usable while the reminder is off, just dimmed.
  const dim = cx(s.dimmable, !r.on && s.off);

  const update = (patch: CommonPatch) => dataActions.updateSettings((st) => withReminder(st, kind, patch));

  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader
        size="sm"
        as={headingLevel}
        title={REMINDER_TITLES[kind]}
        titleId={titleId}
        subtitle={reminderSubtitle(kind, rem)}
        right={<Switch checked={r.on} onChange={(on) => update({ on })} aria-labelledby={titleId} />}
      />
      {kind === 'workout' ? (
        <WeekdayPicker
          mode="multi"
          value={rem.workout.days}
          onChange={(days) => dataActions.updateSettings((st) => withReminder(st, 'workout', { days }))}
          aria-label={REMINDER_DAYS_LABELS.workout}
          className={dim}
        />
      ) : (
        <WeekdayPicker
          mode="single"
          value={rem[kind].day}
          onChange={(day) => dataActions.updateSettings((st) => withReminder(st, kind, { day }))}
          aria-label={REMINDER_DAYS_LABELS[kind]}
          className={dim}
        />
      )}
      {kind === 'workout' && <WorkoutSchedule planDays={rem.workout.days} />}
      <div className={cx(s.timeRow, dim)}>
        <label htmlFor={timeId} className={s.timeLabel}>
          Час
        </label>
        <TimeInput
          id={timeId}
          value={r.time}
          onChange={(time) => update({ time })}
          aria-describedby={titleId}
        />
      </div>
    </Card>
  );
}

/**
 * Under the workout days (§3.7): which workout is on which day — «За розкладом: Пн, Ср — Ноги + прес · Пт — Верх
 * тіла» —, a day outside the plan struck with «не в плані» (no reminder comes that day), the one-sentence rule and
 * «Мої тренування →». Nothing while no workout has days.
 */
function WorkoutSchedule({ planDays }: { planDays: Reminders['workout']['days'] }) {
  const items = workoutSchedule(useAppData().workouts, planDays);
  const [location] = useLocation();
  const titleId = useId();
  if (items.length === 0) return null;
  return (
    <div className={s.schedule} role="group" aria-labelledby={titleId}>
      <p id={titleId} className={s.scheduleTitle}>
        За розкладом
      </p>
      <ul className={s.scheduleList}>
        {items.map((item) => (
          <li key={item.workoutId}>
            {item.days.map((d, i) => (
              <Fragment key={d.label}>
                {i > 0 && ', '}
                {d.inPlan ? (
                  d.label
                ) : (
                  <>
                    <s className={s.offPlan}>{d.label}</s> <span className={s.offPlanNote}>({NOT_IN_PLAN})</span>
                  </>
                )}
              </Fragment>
            ))}
            {' — '}
            <span className={s.scheduleName}>{item.name}</span>
          </li>
        ))}
      </ul>
      <p className={s.scheduleNote}>{SCHEDULE_SENTENCE}</p>
      <Link href={WORKOUTS_PATH} state={backState(location)} className={s.scheduleLink}>
        Мої тренування →
      </Link>
    </div>
  );
}

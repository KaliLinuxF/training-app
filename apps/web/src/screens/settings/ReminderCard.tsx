import { useId } from 'react';
import type { ReminderKind, Reminders, WeeklyReminder } from '@legko/shared';
import { dataActions } from '@/store/data';
import { Card, CardHeader, cx, Switch, TimeInput, WeekdayPicker } from '@/ui';
import { REMINDER_DAYS_LABELS, REMINDER_TITLES, reminderSubtitle, withReminder } from './model';
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

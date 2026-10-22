import { dWeekdayLong, f0, formatDuration, type WorkoutSession } from '@legko/shared';
import { exercisePath } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import {
  Button,
  Card,
  cx,
  fullRowClass,
  ListGroup,
  ListRow,
  StatStrip,
  useBackTo,
  type StatItem,
} from '@/ui';
import type { BackTarget } from './backTarget';
import { PageHeader } from './PageHeader';
import { summaryOf } from './sessionModel';
import s from './SessionScreen.module.css';

export const SAVED_STATUS = '✓ Тренування збережено';
export const DURATION_NOTE = 'Тривалість можна виправити в «Змінити»';
export const KCAL_FOOTNOTE = 'Оцінка: MET × вага × час';

export interface SessionSummaryProps {
  session: WorkoutSession;
  back: BackTarget;
  /** Right after finishing / saving: «✓ Тренування збережено». */
  justSaved: boolean;
  onEdit: () => void;
}

/** A finished session (§3.11): duration, volume, sets, kcal, new records, the exercises; «Готово» / «Змінити». */
export function SessionSummary({ session, back, justSaved, onEdit }: SessionSummaryProps) {
  const data = useAppData();
  const backTo = useBackTo(back.href);
  const sum = summaryOf(data, session);
  const items: StatItem[] = [
    { label: 'Тривалість', value: formatDuration(sum.durationSec) },
    ...(sum.volumeKg > 0 ? [{ label: 'Обʼєм', value: f0(sum.volumeKg), unit: 'кг' }] : []),
    { label: 'Підходів', value: String(sum.setsDone) },
    { label: 'Спалено', value: `≈ ${f0(sum.kcal)}`, unit: 'ккал' },
  ];
  const subtitle = [
    dWeekdayLong(session.date),
    sum.durationSec === null ? null : formatDuration(sum.durationSec),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={s.page}>
      <PageHeader
        back={{ href: back.href, label: back.label, onBack: () => backTo() }}
        title={session.name}
        subtitle={subtitle}
      />

      {justSaved && (
        <p className={cx(s.saved, fullRowClass)} role="status">
          {SAVED_STATUS}
        </p>
      )}

      <Card className={fullRowClass} gap={10}>
        <StatStrip items={items} aria-label="Підсумок тренування" />
        {sum.durationIgnored && <p className={s.note}>{DURATION_NOTE}</p>}
        <p className={s.footnote}>{KCAL_FOOTNOTE}</p>
      </Card>

      {sum.records.length > 0 && (
        <ListGroup full caption="Нові рекорди">
          {sum.records.map((r) => (
            <ListRow
              key={r.exerciseId}
              icon="trophy"
              iconTone="acc"
              title={r.name}
              value={r.text}
              valueVariant="soft"
            />
          ))}
        </ListGroup>
      )}

      {sum.exercises.length > 0 && (
        <ListGroup full caption="Вправи">
          {sum.exercises.map((row) => (
            <ListRow key={row.key} href={exercisePath(row.exerciseId)} title={row.name} sub={row.value} />
          ))}
        </ListGroup>
      )}

      <div className={cx(s.after, fullRowClass)}>
        <Button size="lg" fullWidth onClick={() => backTo()}>
          Готово
        </Button>
        <Button variant="outline" fullWidth onClick={onEdit}>
          Змінити
        </Button>
      </div>
    </div>
  );
}

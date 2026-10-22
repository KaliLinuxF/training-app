import type { AppData, CoachSummary, ISODate } from '@legko/shared';
import { useId, useMemo } from 'react';
import { Card, CardHeader, ContentGrid, ListGroup, ListRow, Pill, StatStrip } from '@/ui';
import { COACH_COPY, rangeTitle, TAB_LABELS } from './copy';
import { buildWorkoutsModel, type CoachSessionModel } from './workoutsModel';
import s from './WorkoutsPanel.module.css';

export interface WorkoutsPanelProps {
  data: AppData;
  /** The client's today. */
  today: ISODate;
  summary: CoachSummary;
}

/**
 * «Тренування» (docs/workouts-steps-rebrand.md §3.18): the period card (schedule line + strip), then every done
 * session of the period newest first, one static row per exercise with its sets, «Пропущено» for a skipped one and a
 * neutral «рекорд» pill on a personal record. Static rows only: no chevrons, toggles or links into her pages.
 */
export function WorkoutsPanel({ data, today, summary }: WorkoutsPanelProps) {
  const model = useMemo(() => buildWorkoutsModel(data, today, summary), [data, today, summary]);
  const periodId = useId();
  return (
    <ContentGrid>
      <h2 className="visually-hidden">{TAB_LABELS.workouts}</h2>
      <Card as="section" full aria-labelledby={periodId}>
        <CardHeader title={rangeTitle(summary.period)} titleId={periodId} />
        <p className={s.schedule}>{model.schedule}</p>
        <StatStrip items={model.strip} columns={2} desktopColumns={4} />
      </Card>
      {model.sessions.length === 0 ? (
        <Card full>
          <p className={s.empty}>{COACH_COPY.noSessions}</p>
        </Card>
      ) : (
        model.sessions.map((session) => <CoachSessionGroup key={session.id} session={session} />)
      )}
    </ContentGrid>
  );
}

/** One done session: title, «48 хв · ≈ 310 ккал» and its exercises (also under a day of «Календар»). */
export function CoachSessionGroup({ session }: { session: CoachSessionModel }) {
  return (
    <ListGroup title={session.title} subtitle={session.value ?? undefined}>
      {session.rows.map((row) => (
        <ListRow
          key={row.key}
          title={row.title}
          sub={row.sub}
          subTone={row.skipped ? 'faint' : undefined}
          subWrap
          trailing={
            row.record ? (
              <Pill tone="neutral" size="sm">
                {COACH_COPY.record}
              </Pill>
            ) : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

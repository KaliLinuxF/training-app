import { Button, ListGroup, ListRow, Pill } from '@/ui';
import {
  LIVE_CTA,
  RECORDED_HEADING,
  SCHEDULED_PILL,
  type WorkoutSheetModel,
  type WorkoutStartRow,
} from './workoutSheetModel';
import s from './WorkoutPlan.module.css';

export interface WorkoutPlanProps {
  model: WorkoutSheetModel;
  /** A start row: today → start (and open the session), a past day → the log screen. */
  onStart: (row: WorkoutStartRow) => void;
  /** «Продовжити» on the live session, or a recorded session (its summary). */
  onOpenSession: (sessionId: string) => void;
}

/**
 * The workouts part of the «Тренування» sheet, above «Або просто відміть»: the live session («Тренування триває —
 * Продовжити») or the start group (scheduled first, a «За планом» pill), then «Записано».
 */
export function WorkoutPlan({ model, onStart, onOpenSession }: WorkoutPlanProps) {
  const { live, start, recorded } = model;
  return (
    <>
      {live ? (
        <ListGroup aria-label={live.title}>
          <ListRow
            icon="timer"
            iconTone="acc"
            title={live.title}
            sub={live.sub}
            value={LIVE_CTA}
            valueVariant="soft"
            valueTone="acc"
            aria-label={live.label}
            onClick={() => onOpenSession(live.sessionId)}
          />
        </ListGroup>
      ) : (
        start && (
          <ListGroup caption={model.startHeading}>
            {start.map((row) => (
              <ListRow
                key={row.key}
                icon={row.workoutId === null ? 'plus' : 'play'}
                iconTone={row.scheduled ? 'acc' : 'neutral'}
                title={row.title}
                sub={row.sub}
                value={
                  row.scheduled ? (
                    <Pill tone="acc" size="sm">
                      {SCHEDULED_PILL}
                    </Pill>
                  ) : undefined
                }
                aria-label={row.label}
                onClick={() => onStart(row)}
              />
            ))}
          </ListGroup>
        )
      )}
      {recorded.length > 0 && (
        <ListGroup caption={RECORDED_HEADING}>
          {recorded.map((row) => (
            <ListRow
              key={row.sessionId}
              icon="check"
              iconTone="acc2"
              title={row.title}
              sub={row.sub}
              aria-label={row.label}
              onClick={() => onOpenSession(row.sessionId)}
            />
          ))}
        </ListGroup>
      )}
    </>
  );
}

export interface WorkoutLinkProps {
  text: string;
  onClick: () => void;
}

/** «Мої тренування →» / «Скласти своє тренування →»: a left-aligned ghost link under the sheet's blocks. */
export function WorkoutLink({ text, onClick }: WorkoutLinkProps) {
  return (
    <Button variant="ghost" className={s.link} onClick={onClick}>
      {text}
    </Button>
  );
}

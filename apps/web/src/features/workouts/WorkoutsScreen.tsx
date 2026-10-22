import { useState } from 'react';
import { useLocation } from 'wouter';
import { addDays } from '@legko/shared';
import { useIsDesktop } from '@/lib/platform';
import { useToday } from '@/lib/useToday';
import {
  HISTORY_PATH,
  LIBRARY_PATH,
  sessionPath,
  WORKOUT_NEW_PATH,
  WORKOUTS_PATH,
  workoutEditPath,
} from '@/lib/workoutRoutes';
import { startWorkout } from '@/sheets/startWorkout';
import { useClock } from '@/sheets/useClock';
import { useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import {
  backState,
  Banner,
  Button,
  ContentGrid,
  cx,
  fullRowClass,
  ListGroup,
  ListRow,
  Pill,
  ScreenHeader,
} from '@/ui';
import { backTarget } from './backTarget';
import { recordsText } from './copy';
import { workoutsList } from './listModel';
import s from './WorkoutsScreen.module.css';

export const EMPTY_TEXT =
  'Склади тренування з вправ і відмічай кожен підхід — вага підставиться з минулого разу.';

/**
 * «Мої тренування» (`/workouts`, §3.5): the live session first (a compact Banner «Продовжити»), her workouts (row →
 * builder, «Почати» / «Продовжити» beside it), unfinished old sessions, «+ Нове тренування» and «Ще».
 */
export function WorkoutsScreen() {
  const data = useAppData();
  const today = useToday();
  const isDesktop = useIsDesktop();
  const [, navigate] = useLocation();
  const hasActive = data.sessions.some((x) => x.status === 'active');
  const now = useClock(hasActive);
  const list = workoutsList(data, today, now);
  // Read once: a top-level page on the desktop (sidebar) needs no back link unless she came from somewhere.
  const [back] = useState(() => {
    const target = backTarget(window.history.state, '/', [WORKOUTS_PATH + '/']);
    return isDesktop && target.href === '/' ? undefined : target;
  });

  const open = (id: string) => navigate(sessionPath(id), { state: backState(WORKOUTS_PATH) });
  const start = (workoutId: string) => {
    void startWorkout(today, workoutId).then((id) => {
      if (id !== null) open(id);
    });
  };

  return (
    <ContentGrid>
      <ScreenHeader back={back} title="Мої тренування" />

      {list.live && (
        <Banner
          size="compact"
          title={list.live.title}
          cta="Продовжити"
          onAction={() => open(list.live?.sessionId ?? '')}
        />
      )}

      {list.rows.length > 0 ? (
        <ListGroup full aria-label="Мої тренування">
          {list.rows.map((row) => (
            <ListRow
              key={row.id}
              href={workoutEditPath(row.id)}
              title={row.name}
              sub={row.sub}
              value={
                row.today ? (
                  <Pill tone="acc" size="sm">
                    Сьогодні
                  </Pill>
                ) : undefined
              }
              chevron={false}
              trailing={
                <Button
                  size="sm"
                  variant={row.live ? 'accent' : 'solid'}
                  aria-label={`${row.live ? 'Продовжити' : 'Почати'} тренування «${row.name}»`}
                  onClick={() => (row.live && list.liveSessionId ? open(list.liveSessionId) : start(row.id))}
                >
                  {row.live ? 'Продовжити' : 'Почати'}
                </Button>
              }
            />
          ))}
        </ListGroup>
      ) : (
        <div className={cx(s.empty, fullRowClass)}>
          <p className={s.emptyText}>{EMPTY_TEXT}</p>
        </div>
      )}

      {list.stale.length > 0 && (
        <ListGroup full caption="Незавершені">
          {list.stale.map((row) => (
            <ListRow
              key={row.sessionId}
              href={sessionPath(row.sessionId)}
              title={row.title}
              subTone="muted"
              sub="Не завершено"
            />
          ))}
        </ListGroup>
      )}

      <div className={cx(s.newRow, fullRowClass)}>
        <Button
          variant="outline"
          fullWidth
          onClick={() => navigate(WORKOUT_NEW_PATH, { state: backState(WORKOUTS_PATH) })}
        >
          + Нове тренування
        </Button>
      </div>

      <ListGroup full caption="Ще">
        <ListRow href={LIBRARY_PATH} icon="search" title="Бібліотека вправ" />
        {list.doneCount > 0 && (
          <ListRow
            href={HISTORY_PATH}
            icon="calendar"
            title="Історія тренувань"
            value={recordsText(list.doneCount)}
            valueVariant="soft"
          />
        )}
        <ListRow
          icon="plus"
          title="Записати минуле тренування"
          aria-haspopup="dialog"
          onClick={() => ui.openSheet(addDays(today, -1), 'workout')}
        />
      </ListGroup>
    </ContentGrid>
  );
}

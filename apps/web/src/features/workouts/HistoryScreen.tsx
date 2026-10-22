import { useState } from 'react';
import { sessionPath, WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import { ContentGrid, cx, fullRowClass, ListGroup, ListRow, ScreenHeader } from '@/ui';
import { backTarget } from './backTarget';
import { historyGroups } from './listModel';
import s from './WorkoutsScreen.module.css';

export const HISTORY_EMPTY = 'Ще немає записаних тренувань. Почни тренування — і воно зʼявиться тут.';

/** «Історія тренувань» (`/workouts/history`, §3.12): done sessions by month, newest first → the summary. */
export function HistoryScreen() {
  const data = useAppData();
  const groups = historyGroups(data);
  const [back] = useState(() =>
    backTarget(window.history.state, WORKOUTS_PATH, ['/workouts/history', '/workouts/session/']),
  );
  return (
    <ContentGrid>
      <ScreenHeader back={back} title="Історія тренувань" />
      {groups.length === 0 ? (
        <div className={cx(s.empty, fullRowClass)}>
          <p className={s.emptyText}>{HISTORY_EMPTY}</p>
        </div>
      ) : (
        groups.map((g) => (
          <ListGroup key={g.month} full caption={g.month}>
            {g.rows.map((row) => (
              <ListRow
                key={row.sessionId}
                href={sessionPath(row.sessionId)}
                title={row.title}
                sub={row.sub}
                aria-label={row.label}
              />
            ))}
          </ListGroup>
        ))
      )}
    </ContentGrid>
  );
}

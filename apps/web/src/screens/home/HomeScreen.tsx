import { flushSync } from 'react-dom';
import { useLocation } from 'wouter';
import { useToday } from '@/lib/useToday';
import { sessionPath } from '@/lib/workoutRoutes';
import { startWorkout } from '@/sheets/startWorkout';
import { setTrainedMark } from '@/store/dayMarks';
import { ui } from '@/store/ui';
import { Avatar, Banner, ContentGrid, FullRow, ListGroup, ListRow, ScreenHeader } from '@/ui';
import { HeroCard } from './HeroCard';
import { HOME_ROW_ACTIONS, OFFLINE_NOTE, type HomeRowId, type HomeTrainingAction } from './homeModel';
import { TodayCard } from './TodayCard';
import { useHomeModel } from './useHomeModel';
import s from './HomeScreen.module.css';

/**
 * «Головна» — redesign A «Чек-лист дня»: one phone screen with the header, at most one compact banner, the compact
 * hero, the «Сьогодні» list of four action rows and the week row (docs/redesign-a.md §4.2).
 */
export function HomeScreen() {
  const today = useToday();
  const { model, dismissInstallHint } = useHomeModel(today);
  const { banner, week } = model;

  const open = (id: HomeRowId) => {
    const action = id === 'food' ? model.rows.food.action : HOME_ROW_ACTIONS[id];
    if (action.mode === 'meal') {
      // Nothing logged today → the new-meal editor. Rendered inside this tap so its «Що я їла» autoFocus opens the
      // iPhone keyboard (iOS ignores a focus() that comes after the gesture).
      flushSync(() => ui.openSheet(today, action.mode, action.patch));
      return;
    }
    ui.openSheet(today, action.mode, action.patch);
  };
  const openDay = () => ui.openSheet(today, 'day');
  // Saves at once (no sheet) and toasts «Відмічено: …»; pressing the already pressed option does nothing.
  const setTrained = (trained: boolean) => {
    setTrainedMark(today, trained);
  };
  // «Почати» / «Продовжити»: the session screen (workouts package); 2+ scheduled workouts → pick one in the sheet.
  const [, navigate] = useLocation();
  const workoutAction = (action: HomeTrainingAction) => {
    if (action.kind === 'continue') navigate(sessionPath(action.sessionId));
    else if (action.kind === 'choose') ui.openSheet(today, 'workout');
    else if (action.kind === 'start')
      void startWorkout(today, action.workoutId).then((id) => {
        if (id !== null) navigate(sessionPath(id));
      });
  };

  return (
    <ContentGrid>
      <ScreenHeader subtitle={model.todayLabel} title={model.greeting} right={<Avatar />} />

      {model.offline && (
        <FullRow className={s.offlineRow}>
          <p className={s.offline} role="status">
            <span className={s.offlineDot} aria-hidden="true" />
            {OFFLINE_NOTE}
          </p>
        </FullRow>
      )}

      {banner && (
        <Banner
          size="compact"
          title={banner.title}
          sub={banner.sub}
          cta={banner.cta}
          onAction={() => ui.openSheet(today, banner.action.mode, banner.action.patch)}
          onDismiss={banner.dismissible ? dismissInstallHint : undefined}
        />
      )}

      <HeroCard hero={model.hero} className={s.hero} />

      <TodayCard
        rows={model.rows}
        onOpen={open}
        onOpenDay={openDay}
        onTrained={setTrained}
        onWorkoutAction={workoutAction}
        className={s.today}
      />

      <ListGroup flush className={s.week}>
        <ListRow
          href={week.href}
          title="Тиждень"
          value={week.text}
          valueVariant="soft"
          aria-label={week.label}
        />
      </ListGroup>
    </ContentGrid>
  );
}

import { useToday } from '@/lib/useToday';
import { setTrainedMark } from '@/store/dayMarks';
import { ui } from '@/store/ui';
import { Avatar, Banner, ContentGrid, FullRow, ListGroup, ListRow, ScreenHeader } from '@/ui';
import { HeroCard } from './HeroCard';
import { HOME_ROW_ACTIONS, OFFLINE_NOTE, type HomeRowId } from './homeModel';
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
    const action = HOME_ROW_ACTIONS[id];
    ui.openSheet(today, action.mode, action.patch);
  };
  const openDay = () => ui.openSheet(today, 'day');
  // Saves at once (no sheet) and toasts «Відмічено: …»; pressing the already pressed option does nothing.
  const setTrained = (trained: boolean) => {
    setTrainedMark(today, trained);
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

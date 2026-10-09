import { useId } from 'react';
import type { ChangeTone } from '@/lib/stats';
import { useToday } from '@/lib/useToday';
import { dataActions, getAppData } from '@/store/data';
import { ui } from '@/store/ui';
import {
  Avatar,
  Banner,
  Card,
  CardHeader,
  ContentGrid,
  FullRow,
  KeyValueRow,
  QuickAction,
  ScreenHeader,
  Section,
  StatTile,
  Tile,
  type Tone,
} from '@/ui';
import { DismissibleBanner } from './DismissibleBanner';
import { HeroCard } from './HeroCard';
import { markNoTraining, NO_TRAINING_TOAST, OFFLINE_NOTE, QUICK_ACTIONS, type HomeAction } from './homeModel';
import { TodayCard } from './TodayCard';
import { useHomeModel } from './useHomeModel';
import s from './HomeScreen.module.css';

/** Change colours: smaller is good (mint), bigger is lavender — the prototype's `tone()`. */
const TONES: Record<ChangeTone, Tone> = { down: 'acc2', up: 'acc', flat: 'ink' };

/** «Головна» (Tracker.dc.html lines 33–136). */
export function HomeScreen() {
  const today = useToday();
  const { model, dismissInstallHint } = useHomeModel(today);
  const measuresTitleId = useId();

  const open = (action: HomeAction) => ui.openSheet(today, action.mode, action.patch);
  const openToday = () => ui.openSheet(today, 'day');
  const markTrained = (trained: boolean) => {
    if (trained) {
      ui.openSheet(today, 'day', { trained: true });
      return;
    }
    // A refused save already shows the sync notice; the toast would claim it was recorded.
    if (dataActions.saveDay(today, markNoTraining(getAppData().days[today]))) ui.flash(NO_TRAINING_TOAST);
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

      {model.banners.map((b) =>
        b.dismissible ? (
          <DismissibleBanner
            key={b.id}
            title={b.title}
            sub={b.sub}
            cta={b.cta}
            onAction={() => open(b.action)}
            onDismiss={dismissInstallHint}
          />
        ) : (
          <Banner key={b.id} title={b.title} sub={b.sub} cta={b.cta} onAction={() => open(b.action)} />
        ),
      )}

      <HeroCard hero={model.hero} />

      <TodayCard today={model.today} onOpen={openToday} onTrained={markTrained} />

      <div className={s.quick}>
        <div className={s.quickGrid}>
          {QUICK_ACTIONS.map((q) => (
            <QuickAction key={q.label} label={q.label} tone={q.tone} onClick={() => open(q.action)} />
          ))}
        </div>
      </div>

      <Section title="Цей тиждень">
        <div className={s.pair}>
          {model.week.map((t) => (
            <StatTile key={t.id} label={t.label} value={t.value} unit={t.unit} tone={TONES[t.tone]} />
          ))}
        </div>
      </Section>

      <Card as="section" aria-labelledby={measuresTitleId}>
        <CardHeader title="Поточні заміри" titleId={measuresTitleId} meta={model.measures.date} />
        <div className={s.triple}>
          {model.measures.tiles.map((m) => (
            <Tile
              key={m.key}
              variant="measure"
              label={m.label}
              value={m.value}
              sub={m.delta}
              subTone={m.hasDelta ? 'acc2' : 'faint'}
            />
          ))}
        </div>
      </Card>

      <Card variant="list" className={s.control}>
        {model.control.map((row) => (
          <KeyValueRow key={row.label} label={row.label} value={row.value} />
        ))}
      </Card>
    </ContentGrid>
  );
}

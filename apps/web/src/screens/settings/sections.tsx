import type { ReactNode } from 'react';
import type { ISODate, Settings } from '@legko/shared';
import type { ThemePref } from '@/lib/theme';
import { AppearanceCard } from './AppearanceCard';
import { DataCard } from './DataCard';
import { GoalsCard } from './GoalsCard';
import type { SettingsSectionId } from './listModel';
import { REMINDER_ORDER } from './model';
import { NotificationsCard } from './NotificationsCard';
import { ReminderCard } from './ReminderCard';
import type { PushStatusState } from './usePushStatus';
import { WorkoutTypesCard } from './WorkoutTypesCard';

/** What every section body gets from SettingsScreen (the per-device state is lifted there, see D27). */
export interface SectionBodyProps {
  today: ISODate;
  settings: Settings;
  push: PushStatusState;
  themePref: ThemePref;
  setThemePref: (pref: ThemePref) => void;
  /** Level of the cards' own titles: `h2` on a phone sub-page (under its <h1>), `h3` in the desktop pane. */
  headingLevel: 'h2' | 'h3';
}

/** The cards of each sub-page, in order (grid / flex items of the page or pane). */
export const SECTION_BODIES: Readonly<Record<SettingsSectionId, (props: SectionBodyProps) => ReactNode>> = {
  reminders: ({ today, settings, push, headingLevel }) => (
    <>
      <NotificationsCard today={today} push={push} headingLevel={headingLevel} />
      {REMINDER_ORDER.map((kind) => (
        <ReminderCard key={kind} kind={kind} rem={settings.rem} headingLevel={headingLevel} />
      ))}
    </>
  ),
  goals: ({ settings }) => <GoalsCard settings={settings} />,
  workouts: ({ settings }) => <WorkoutTypesCard customTypes={settings.customTypes} />,
  // In the desktop pane (h3 titles) the pane's own region «Вигляд» names the card.
  appearance: ({ themePref, setThemePref, headingLevel }) => (
    <AppearanceCard pref={themePref} onChange={setThemePref} inPane={headingLevel === 'h3'} />
  ),
  data: () => <DataCard />,
};

import { useToday } from '@/lib/useToday';
import { useSettings } from '@/store/data';
import { ContentGrid, ScreenHeader } from '@/ui';
import { AccountFooter } from './AccountFooter';
import { AppearanceCard } from './AppearanceCard';
import { DataCard } from './DataCard';
import { GoalsCard } from './GoalsCard';
import { REMINDER_ORDER } from './model';
import { NotificationsCard } from './NotificationsCard';
import { ReminderCard } from './ReminderCard';
import { WorkoutTypesCard } from './WorkoutTypesCard';
import s from './RemindersScreen.module.css';

/** «Нагадування»: push on this device, the three reminders, goals and the app's settings. */
export function RemindersScreen() {
  const settings = useSettings();
  const today = useToday();
  return (
    <ContentGrid>
      <ScreenHeader subtitle="Дні, час і цілі" title="Нагадування" />
      <NotificationsCard today={today} />
      {REMINDER_ORDER.map((kind) => (
        <ReminderCard key={kind} kind={kind} rem={settings.rem} />
      ))}
      <GoalsCard settings={settings} />
      <WorkoutTypesCard customTypes={settings.customTypes} />
      {/* One grid cell on desktop, so the two short cards sit next to the taller types card. */}
      <div className={s.stack}>
        <AppearanceCard />
        <DataCard />
      </div>
      <AccountFooter />
    </ContentGrid>
  );
}

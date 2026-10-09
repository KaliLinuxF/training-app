import type { ReactNode, Ref } from 'react';
import type { ThemePref } from '@/lib/theme';
import { useSettings, useSyncState } from '@/store/data';
import { cx, fullRowClass, ListGroup, ListRow, Pill, ScreenHeader } from '@/ui';
import {
  goalsSummary,
  notifBadge,
  remindersSummary,
  SECTION_ICONS,
  SECTION_TITLES,
  SETTINGS_GROUPS,
  settingsPath,
  syncShort,
  themeSummary,
  typesSummary,
  type SettingsSectionId,
} from './listModel';
import { LogoutRow } from './LogoutRow';
import { SyncDot } from './SyncDot';
import type { PushStatusState } from './usePushStatus';
import s from './SettingsList.module.css';

export interface SettingsListProps {
  /** The section shown next to the list (desktop): its row gets `aria-current="page"`. `null` on the phone list. */
  current: SettingsSectionId | null;
  push: PushStatusState;
  themePref: ThemePref;
  /** Phone: the list is the page, with its own <h1> «Налаштування». Desktop: SettingsScreen renders the header. */
  showHeader: boolean;
  /** The `<nav>` of section links (SettingsScreen focuses a row in it after a phone sub-page). */
  ref?: Ref<HTMLElement>;
}

export const SETTINGS_CAPTION = 'Легко · трекер схуднення';

/**
 * «Налаштування» list: the header (phone), two groups of section links with a one-line summary each, «Вийти» in its
 * own group and the app caption. Renders grid / flex items for its parent: the phone's ContentGrid (classic layout,
 * right under the header, gap 14) or the desktop's sticky left column.
 *
 * Desktop: the row of the section on screen is `current` and `replace`s, so clicking it again adds no history entry
 * (like a plain link to the page you are on). Its push badge is lifted onto the card colour there (see the CSS).
 */
export function SettingsList({ current, push, themePref, showHeader, ref }: SettingsListProps) {
  const settings = useSettings();
  const sync = syncShort(useSyncState());
  const badge = notifBadge(push.status);

  const values: Record<SettingsSectionId, ReactNode> = {
    reminders: remindersSummary(settings.rem),
    goals: goalsSummary(settings),
    workouts: typesSummary(settings.customTypes),
    appearance: themeSummary(themePref),
    data: (
      <span className={s.sync}>
        <SyncDot tone={sync.tone} />
        {sync.text}
      </span>
    ),
  };

  return (
    <>
      {showHeader && <ScreenHeader title="Налаштування" />}
      <nav ref={ref} aria-label="Розділи налаштувань" className={cx(s.nav, fullRowClass)}>
        {SETTINGS_GROUPS.map((group) => (
          <ListGroup key={group.join()}>
            {group.map((id) => (
              <ListRow
                key={id}
                href={settingsPath(id)}
                icon={SECTION_ICONS[id].icon}
                iconTone={SECTION_ICONS[id].tone}
                title={SECTION_TITLES[id]}
                value={values[id]}
                valueVariant="soft"
                current={id === current}
                replace={id === current}
                sub={
                  id === 'reminders' && badge ? (
                    <Pill tone={badge.tone} size="sm" className={s.badge}>
                      {badge.text}
                    </Pill>
                  ) : undefined
                }
              />
            ))}
          </ListGroup>
        ))}
      </nav>
      <ListGroup full>
        <LogoutRow />
      </ListGroup>
      <p className={cx(s.caption, fullRowClass)}>{SETTINGS_CAPTION}</p>
    </>
  );
}

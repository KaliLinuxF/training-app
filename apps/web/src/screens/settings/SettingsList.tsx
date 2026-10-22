import type { ReactNode, Ref } from 'react';
import { useCurrentUser } from '@/auth/auth';
import type { ThemePref } from '@/lib/theme';
import { useSettings, useSyncState } from '@/store/data';
import { cx, fullRowClass, ListGroup, ListRow, Pill, ScreenHeader } from '@/ui';
import {
  accountSummary,
  goalsSummary,
  mealTypesSummary,
  notifBadge,
  remindersSummary,
  SECTION_ICONS,
  SECTION_TITLES,
  settingsGroups,
  settingsPath,
  showsCaption,
  syncShort,
  themeSummary,
  typesSummary,
  usersSummary,
  type SettingsSectionId,
} from './listModel';
import { SyncDot } from './SyncDot';
import { useAdminOverview } from './users/adminOverview';
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

export const SETTINGS_CAPTION = 'Home Fit · трекер схуднення';

/**
 * «Налаштування» list: the header (phone), the groups of section links with a one-line summary each — the last
 * group is the account («Акаунт» = the username; «Користувачі» = how many accounts, admins only), where the
 * «Вийти» card used to be (D30; «Вийти» is on the «Акаунт» page now) — and the app caption (hidden while the
 * «Користувачі» row shows, so the list still fits one iPhone screen). Renders grid / flex items for its parent: the
 * phone's ContentGrid (classic layout, right under the header, gap 14) or the desktop's sticky left column.
 *
 * Desktop: the row of the section on screen is `current` and `replace`s, so clicking it again adds no history entry
 * (like a plain link to the page you are on). Its push badge is lifted onto the card colour there (see the CSS).
 */
export function SettingsList({ current, push, themePref, showHeader, ref }: SettingsListProps) {
  const settings = useSettings();
  const sync = syncShort(useSyncState());
  const badge = notifBadge(push.status);
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const { overview } = useAdminOverview(isAdmin ? user.id : null);
  const groups = settingsGroups(isAdmin);

  const values: Record<SettingsSectionId, ReactNode> = {
    reminders: remindersSummary(settings.rem),
    goals: goalsSummary(settings),
    workouts: typesSummary(settings.customTypes),
    meals: mealTypesSummary(settings.mealTypes),
    appearance: themeSummary(themePref),
    data: (
      <span className={s.sync}>
        <SyncDot tone={sync.tone} />
        {sync.text}
      </span>
    ),
    account: accountSummary(user),
    users: usersSummary(overview),
  };

  return (
    <>
      {showHeader && <ScreenHeader title="Налаштування" />}
      <nav ref={ref} aria-label="Розділи налаштувань" className={cx(s.nav, fullRowClass)}>
        {groups.map((group) => (
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
      {showsCaption(groups) && <p className={cx(s.caption, fullRowClass)}>{SETTINGS_CAPTION}</p>}
    </>
  );
}

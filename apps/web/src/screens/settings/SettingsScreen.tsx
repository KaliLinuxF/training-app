import { useEffect, useRef } from 'react';
import { Redirect, useParams } from 'wouter';
import { useIsDesktop } from '@/lib/platform';
import { useThemePref } from '@/lib/theme';
import { useToday } from '@/lib/useToday';
import { useSettings } from '@/store/data';
import { ContentGrid, cx, fullRowClass, ScreenHeader } from '@/ui';
import {
  DESKTOP_DEFAULT_SECTION,
  parseSettingsSection,
  SETTINGS_ROOT,
  settingsPath,
  type SettingsSectionId,
} from './listModel';
import { SettingsList } from './SettingsList';
import { SettingsSectionPage } from './SettingsSectionPage';
import { usePushStatus } from './usePushStatus';
import s from './SettingsScreen.module.css';

/**
 * «Налаштування» (`/settings/:section?`).
 * - Phone: `/settings` is the grouped list; `/settings/<section>` a sub-page with «‹ Налаштування». Back from a
 *   sub-page (the back link, the system back or the tab), the row that opened it gets the focus — only when the
 *   focus went away with the sub-page; a fresh visit to the list keeps the browser's focus, like the other tabs.
 * - Desktop: the list in a sticky left column, the section next to it (`/settings` shows the reminders).
 * - Unknown sections redirect to the list.
 *
 * The per-device state that the list and the sections both show is read once here and passed down: the push
 * status (the «Нагадування» badge and the notifications panel) and the theme (the «Вигляд» row and its switch) —
 * on desktop both are on screen at the same time and must not drift apart.
 */
export function SettingsScreen() {
  const { section } = useParams<{ section?: string }>();
  const parsed = parseSettingsSection(section);
  const isDesktop = useIsDesktop();
  const today = useToday();
  const settings = useSettings();
  const push = usePushStatus();
  const [themePref, setThemePref] = useThemePref();
  const navRef = useRef<HTMLElement>(null);
  /** The phone sub-page on screen (or last on screen), whose row takes the focus back on the list. */
  const lastSection = useRef<SettingsSectionId | null>(null);

  useEffect(() => {
    if (isDesktop || parsed === 'invalid') {
      lastSection.current = null;
      return;
    }
    if (parsed !== null) {
      lastSection.current = parsed;
      return;
    }
    const from = lastSection.current;
    lastSection.current = null;
    const active = document.activeElement;
    // Only when the focus was lost with the sub-page: a keyboard user who pressed the tab keeps it there.
    if (!from || (active && active !== document.body && active.isConnected)) return;
    navRef.current
      ?.querySelector<HTMLAnchorElement>(`a[href="${settingsPath(from)}"]`)
      ?.focus({ preventScroll: true });
  }, [isDesktop, parsed]);

  if (parsed === 'invalid') return <Redirect to={SETTINGS_ROOT} replace />;

  const body = { today, settings, push, themePref, setThemePref };

  if (isDesktop) {
    const current = parsed ?? DESKTOP_DEFAULT_SECTION;
    return (
      <ContentGrid>
        <ScreenHeader title="Налаштування" />
        <div className={cx(s.split, fullRowClass)}>
          <div className={s.side}>
            <SettingsList current={current} push={push} themePref={themePref} showHeader={false} />
          </div>
          <SettingsSectionPage key={current} id={current} variant="pane" {...body} />
        </div>
      </ContentGrid>
    );
  }

  if (parsed === null) {
    return (
      <ContentGrid>
        <SettingsList ref={navRef} current={null} push={push} themePref={themePref} showHeader />
      </ContentGrid>
    );
  }
  return <SettingsSectionPage key={parsed} id={parsed} variant="page" {...body} />;
}

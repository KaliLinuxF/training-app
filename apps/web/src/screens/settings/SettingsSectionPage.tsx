import { useId, useState } from 'react';
import { cameFrom, ContentGrid, ScreenHeader, SectionTitle } from '@/ui';
import { SECTION_TITLES, SETTINGS_ROOT, type SettingsSectionId } from './listModel';
import { SECTION_BODIES, type SectionBodyProps } from './sections';
import s from './SettingsSectionPage.module.css';

export interface SettingsSectionPageProps extends Omit<SectionBodyProps, 'headingLevel'> {
  id: SettingsSectionId;
  /**
   * - `page` — phone sub-page: «‹ Налаштування» back link and the section title as the <h1>
   * - `pane` — desktop detail next to the list: a region named by its <h2>
   */
  variant: 'page' | 'pane';
}

/** One settings section (`/settings/:section`): its title and its cards. Mount it with `key={id}`. */
export function SettingsSectionPage({ id, variant, ...body }: SettingsSectionPageProps) {
  const titleId = useId();
  // Opened from the list (in-app tap, the row stamped history.state): move focus to the new title once, on mount.
  // A deep link, reload or push URL keeps the browser's own focus.
  const [focusTitle] = useState(() => cameFrom(window.history.state, SETTINGS_ROOT));
  const title = SECTION_TITLES[id];

  if (variant === 'pane') {
    return (
      <section aria-labelledby={titleId} className={s.pane}>
        <SectionTitle id={titleId}>{title}</SectionTitle>
        {SECTION_BODIES[id]({ ...body, headingLevel: 'h3' })}
      </section>
    );
  }
  return (
    <ContentGrid>
      <ScreenHeader
        title={title}
        back={{ href: SETTINGS_ROOT, label: 'Налаштування' }}
        focusTitle={focusTitle}
      />
      {SECTION_BODIES[id]({ ...body, headingLevel: 'h2' })}
    </ContentGrid>
  );
}

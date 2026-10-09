import type { ThemePref } from '@/lib/theme';
import { Card, Segmented } from '@/ui';
import { THEME_OPTIONS } from './model';
import s from './AppearanceCard.module.css';

export interface AppearanceCardProps {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
  /**
   * Inside the desktop pane, which is itself the region «Вигляд» (named by its <h2>): the card is a plain block then,
   * so landmarks do not list «Вигляд» twice, one inside the other. The phone sub-page keeps the card's own region.
   */
  inPane?: boolean;
}

/**
 * «Вигляд»: per-device theme (auto follows the system). The preference is owned by SettingsScreen
 * (`useThemePref` once), so the list's «Вигляд» row next to this card on desktop updates with it.
 */
export function AppearanceCard({ pref, onChange, inPane = false }: AppearanceCardProps) {
  return (
    <Card as={inPane ? 'div' : 'section'} aria-label={inPane ? undefined : 'Вигляд'} gap={10}>
      <Segmented full options={THEME_OPTIONS} value={pref} onChange={onChange} aria-label="Тема" />
      <p className={s.note}>Тема на цьому пристрої</p>
    </Card>
  );
}

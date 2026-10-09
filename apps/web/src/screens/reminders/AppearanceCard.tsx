import { useId } from 'react';
import { useThemePref } from '@/lib/theme';
import { Card, CardHeader, Segmented } from '@/ui';
import { THEME_OPTIONS } from './model';

/** «Вигляд»: per-device theme (auto follows the system). */
export function AppearanceCard() {
  const titleId = useId();
  const [pref, setPref] = useThemePref();
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader size="sm" title="Вигляд" titleId={titleId} subtitle="Тема на цьому пристрої" />
      <Segmented options={THEME_OPTIONS} value={pref} onChange={setPref} aria-label="Тема" />
    </Card>
  );
}

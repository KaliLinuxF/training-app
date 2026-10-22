/**
 * Where a workouts page goes back to: the page that opened it (`history.state.legkoFrom`, stamped by ListRow / our
 * own navigations), else a fallback. The label names that page («‹ Головна», «‹ Мої тренування»).
 */
import { BACK_STATE_KEY } from '@/ui';

export interface BackTarget {
  href: string;
  label: string;
}

const LABELS: readonly (readonly [string, string])[] = [
  ['/workouts/history', 'Історія'],
  ['/workouts/library', 'Вправи'],
  ['/workouts', 'Мої тренування'],
  ['/calendar', 'Календар'],
  ['/progress', 'Прогрес'],
  ['/settings', 'Налаштування'],
];

/** The label of a page we go back to. */
export function backLabel(href: string): string {
  if (href === '/' || href === '') return 'Головна';
  for (const [prefix, label] of LABELS) if (href === prefix || href.startsWith(`${prefix}/`)) return label;
  return 'Назад';
}

/** The page in `state` (when it is an app path other than the screens in `exclude`), else `fallback`. */
export function backTarget(state: unknown, fallback: string, exclude: readonly string[] = []): BackTarget {
  const from =
    typeof state === 'object' && state !== null
      ? (state as Record<string, unknown>)[BACK_STATE_KEY]
      : undefined;
  const usable =
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !exclude.some((p) => from.startsWith(p));
  const href = usable ? from : fallback;
  return { href, label: backLabel(href) };
}

import { useRoute } from 'wouter';
import { useIsDesktop } from '@/lib/platform';
import { LIBRARY_PATH } from '@/lib/workoutRoutes';
import { ExerciseDetailScreen } from './ExerciseDetailScreen';
import { ExerciseLibraryScreen } from './ExerciseLibraryScreen';

export const LIBRARY_ID_PATTERN = `${LIBRARY_PATH}/:id`;

const decode = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * `/workouts/library` and `/workouts/library/:id` (it reads `:id` itself; flat absolute routes, no `nest`).
 * Desktop (≥ 900 px with a mouse): the list with the exercise in a pane next to it. Phone: the list, or the
 * exercise page when there is an id.
 */
export function ExerciseLibraryRoute() {
  const [match, params] = useRoute<{ id: string }>(LIBRARY_ID_PATTERN);
  const id = match && params.id ? decode(params.id) : undefined;
  const isDesktop = useIsDesktop();
  if (isDesktop) return <ExerciseLibraryScreen selectedId={id} />;
  if (id) return <ExerciseDetailScreen key={id} id={id} />;
  return <ExerciseLibraryScreen />;
}

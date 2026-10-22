import { useMemo, useState } from 'react';
import { allExercises } from '@legko/shared';
import { useIsDesktop } from '@/lib/platform';
import { exercisePath } from '@/lib/workoutRoutes';
import { useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import { Button, ContentGrid, cx, fullRowClass, ListGroup, ScreenHeader } from '@/ui';
import { ExerciseDetailPane } from './ExerciseDetailScreen';
import { ExerciseEditorSheet } from './ExerciseEditorSheet';
import { ExerciseRow } from './ExerciseRow';
import { GroupChips, SearchField } from './LibraryControls';
import {
  EMPTY_FILTER,
  filterExercises,
  isLibraryGroup,
  libraryBack,
  type BackTarget,
  type LibraryFilter,
} from './libraryModel';
import s from './ExerciseLibraryScreen.module.css';

export interface ExerciseLibraryScreenProps {
  /** Desktop: the exercise shown in the pane next to the list (`/workouts/library/:id`). */
  selectedId?: string;
  /** Default: «‹ Налаштування» when she came from Settings, else «‹ Тренування». */
  back?: BackTarget;
}

export const NOTHING_FOUND = 'Нічого не знайшлося';
export const PICK_ONE = 'Обери вправу, щоб побачити її мʼязи, прогрес і рекорди.';
/** The search and group survive a visit to an exercise page (this tab only). */
export const FILTER_STORAGE_KEY = 'legko.library.filter';

function loadFilter(): LibraryFilter {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return EMPTY_FILTER;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_FILTER;
    const { query, group } = parsed as Record<string, unknown>;
    return {
      query: typeof query === 'string' ? query.slice(0, 60) : '',
      group: isLibraryGroup(group) ? group : 'all',
    };
  } catch {
    return EMPTY_FILTER;
  }
}

function storeFilter(filter: LibraryFilter): void {
  try {
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Private mode / blocked storage: the filter simply resets next time.
  }
}

/**
 * «Вправи» (`/workouts/library`): search, the group chips, the list, «+ Своя вправа». Desktop (≥ 900 px with a
 * mouse): the list on the left, the selected exercise's detail on the right.
 */
export function ExerciseLibraryScreen({ selectedId, back: backProp }: ExerciseLibraryScreenProps) {
  const own = useAppData().exercises;
  const isDesktop = useIsDesktop();
  const [back] = useState(() => backProp ?? libraryBack(window.history.state));
  const [filter, setFilterState] = useState<LibraryFilter>(loadFilter);
  const [editorOpen, setEditorOpen] = useState(false);
  const setFilter = (next: LibraryFilter) => {
    setFilterState(next);
    storeFilter(next);
  };

  const all = useMemo(() => allExercises(own), [own]);
  const list = useMemo(() => filterExercises(all, filter), [all, filter]);
  const empty = list.length === 0;

  const listColumn = (
    <div className={s.column}>
      <SearchField value={filter.query} onChange={(query) => setFilter({ ...filter, query })} />
      <GroupChips value={filter.group} onChange={(group) => setFilter({ ...filter, group })} />
      {empty ? (
        <p className={s.empty} role="status">
          {NOTHING_FOUND}
        </p>
      ) : (
        <ListGroup aria-label="Список вправ">
          {list.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              href={exercisePath(ex.id)}
              current={isDesktop && ex.id === selectedId}
            />
          ))}
        </ListGroup>
      )}
      <Button variant="outline" fullWidth onClick={() => setEditorOpen(true)} aria-haspopup="dialog">
        + Своя вправа
      </Button>
      <ExerciseEditorSheet
        open={editorOpen}
        initialName={empty ? filter.query : ''}
        onSaved={() => ui.flash('Вправу збережено')}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );

  return (
    <ContentGrid>
      <ScreenHeader back={back} title="Вправи" />
      {isDesktop ? (
        <div className={cx(s.split, fullRowClass)}>
          {listColumn}
          <div className={s.detail}>
            {selectedId ? (
              <ExerciseDetailPane key={selectedId} id={selectedId} />
            ) : (
              <p className={s.placeholder}>{PICK_ONE}</p>
            )}
          </div>
        </div>
      ) : (
        <div className={fullRowClass}>{listColumn}</div>
      )}
    </ContentGrid>
  );
}

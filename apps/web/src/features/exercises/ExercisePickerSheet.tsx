import { useMemo, useState } from 'react';
import { allExercises, type Exercise } from '@legko/shared';
import { useAppData } from '@/store/data';
import { Button, ListGroup, Sheet } from '@/ui';
import { ExerciseEditorSheet } from './ExerciseEditorSheet';
import { ExerciseRow } from './ExerciseRow';
import { GroupChips, SearchField } from './LibraryControls';
import { filterExercises, type LibraryGroup } from './libraryModel';
import s from './ExercisePickerSheet.module.css';

export interface ExercisePickerSheetProps {
  open: boolean;
  /** `multi` (builder): rows toggle a ✓, the footer adds them; `single` (session): a tap picks and closes. */
  mode: 'multi' | 'single';
  /** The picked ids, in the order she picked them. */
  onPick: (ids: string[]) => void;
  onClose: () => void;
  initialQuery?: string;
}

export const PICKER_HEADINGS = { multi: 'Додати вправи', single: 'Додати вправу' } as const;
export const NOTHING_FOUND = 'Нічого не знайшлося';

/** «Додати вправи» / «Додати вправу»: search + groups as in the library; «+ Своя вправа» stacks the editor. */
export function ExercisePickerSheet({ open, mode, onPick, onClose, initialQuery = '' }: ExercisePickerSheetProps) {
  // A fresh search and selection every time it opens (derived from the props while rendering, no effect).
  const [opened, setOpened] = useState(open);
  const [generation, setGeneration] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setGeneration((g) => g + 1);
      setPicked([]);
    }
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickOne = (id: string) => {
    onPick([id]);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      heading={PICKER_HEADINGS[mode]}
      footer={
        mode === 'multi' ? (
          <Button
            size="lg"
            fullWidth
            disabled={picked.length === 0}
            onClick={() => {
              onPick(picked);
              onClose();
            }}
          >
            {`Додати (${picked.length})`}
          </Button>
        ) : undefined
      }
    >
      <PickerBody
        key={generation}
        mode={mode}
        initialQuery={initialQuery}
        picked={picked}
        onToggle={toggle}
        onPickOne={pickOne}
        onCreated={(ex) => (mode === 'multi' ? setPicked((p) => [...p, ex.id]) : pickOne(ex.id))}
      />
    </Sheet>
  );
}

interface PickerBodyProps {
  mode: 'multi' | 'single';
  initialQuery: string;
  picked: readonly string[];
  onToggle: (id: string) => void;
  onPickOne: (id: string) => void;
  onCreated: (exercise: Exercise) => void;
}

function PickerBody({ mode, initialQuery, picked, onToggle, onPickOne, onCreated }: PickerBodyProps) {
  const own = useAppData().exercises;
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState<LibraryGroup>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const all = useMemo(() => allExercises(own), [own]);
  const list = useMemo(() => filterExercises(all, { query, group }), [all, query, group]);

  return (
    <div className={s.body}>
      <SearchField value={query} onChange={setQuery} />
      <GroupChips value={group} onChange={setGroup} edge="sheet" />
      {list.length > 0 ? (
        <ListGroup aria-label="Вправи">
          {list.map((ex) =>
            mode === 'multi' ? (
              <ExerciseRow key={ex.id} exercise={ex} pressed={picked.includes(ex.id)} onToggle={() => onToggle(ex.id)} />
            ) : (
              <ExerciseRow key={ex.id} exercise={ex} onPick={() => onPickOne(ex.id)} />
            ),
          )}
        </ListGroup>
      ) : (
        <p className={s.empty} role="status">
          {NOTHING_FOUND}
        </p>
      )}
      <Button variant="outline" fullWidth onClick={() => setEditorOpen(true)} aria-haspopup="dialog">
        + Своя вправа
      </Button>
      <ExerciseEditorSheet
        open={editorOpen}
        initialName={list.length === 0 ? query : ''}
        onSaved={(ex) => {
          if (group !== 'all' && group !== 'mine') setGroup('mine');
          onCreated(ex);
        }}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
}

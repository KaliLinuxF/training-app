import { addDays, type MeasureKey } from '@legko/shared';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { cx, Sheet } from '@/ui';
import { MeasureField, SAVE_FAILED, SaveFooter, WeightField } from '../fields/fields';
import { measurePlaceholders, sheetDateLabels, stepBaseWeight, weightHint } from '../helpers';
import { useDraft } from '../useDraft';
import { useSheetGuard } from '../useSheetGuard';
import { FoodBlock, NotesBlock, WorkoutBlock } from './blocks';
import { CaptureMenu } from './CaptureMenu';
import { captureMenuDateLine, captureMenuRows } from './menuModel';
import {
  foodUseOps,
  hasRecordErrors,
  initRecordDraft,
  isRecordDirty,
  MENU_HEADING,
  RECORD_HEADINGS,
  recordOps,
  recordSections,
  validateRecord,
  type CaptureMode,
  type RecordDraft,
  type RecordMode,
} from './model';
import s from './RecordSheet.module.css';

export interface RecordSheetProps {
  state: SheetState & { mode: CaptureMode };
  open: boolean;
}

/**
 * The «+» menu «Що записати?» and every record form — «Запис дня», «Їжа», «Тренування»,
 * «Контрольне зважування», «Заміри тіла» (prototype lines 425–510) — in ONE <Sheet>: a menu row
 * swaps heading, date navigator, footer and body of the same dialog in place (no second slide-up,
 * no backdrop flicker; the scroll lock and focus return to «+» stay with the one sheet). So never key
 * this component or its Sheet by mode.
 */
export function RecordSheet({ state, open }: RecordSheetProps) {
  const { date, mode, key } = state;
  const isMenu = mode === 'menu';
  // The menu edits nothing: its draft is an untouched day draft (never dirty), without the patch.
  const formMode: RecordMode = mode === 'menu' ? 'day' : mode;
  const patch = isMenu ? undefined : state.patch;
  const data = useAppData();
  const today = useToday();
  // `current` lets an untouched draft follow a server refresh (another device's changes).
  const { draft, baseline, dirty, update } = useDraft<RecordDraft>(key, {
    init: () => ({
      baseline: initRecordDraft(data, date, formMode),
      draft: initRecordDraft(data, date, formMode, patch),
    }),
    current: initRecordDraft(data, date, formMode),
    differs: isRecordDirty,
  });
  const set = (change: Partial<RecordDraft>) => update((d) => ({ ...d, ...change }));

  // An estimate on screen or text in FoodAssist's composer is unsaved work too. FoodAssist is
  // remounted per open sheet (`key`), and a report from an earlier one never counts.
  const [assist, setAssist] = useState({ key, pending: false });
  const foodPending = assist.key === key && assist.pending;
  const onFoodPending = useCallback(
    (pending: boolean) => setAssist((a) => (a.key === key && a.pending === pending ? a : { key, pending })),
    [key],
  );

  // The draft the store refused to save; the message stays until she edits it.
  const [refused, setRefused] = useState<RecordDraft | null>(null);
  const saveError = refused === draft ? SAVE_FAILED : undefined;

  const show = recordSections(formMode);
  const errors = validateRecord(draft, formMode);
  const invalid = hasRecordErrors(errors);
  const { anchor, close, guard } = useSheetGuard(dirty || foodPending, open);
  const labels = sheetDateLabels(date, today);
  const canNext = date < today;

  // ‹ › keep the sheet's mode.
  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    guard(() => ui.openSheet(addDays(date, delta), formMode));
  };

  const save = () => {
    if (!open || isMenu || invalid) return;
    const ops = recordOps({ baseline, draft, data, date, mode: formMode });
    if (show.food) ops.push(...foodUseOps(draft, date));
    if (!commit(...ops)) {
      setRefused(draft);
      return;
    }
    ui.closeSheet();
    ui.flash('Збережено');
  };

  const onMeasure = (field: MeasureKey, text: string) =>
    update((d) => {
      const next = { ...d };
      next[field] = text;
      return next;
    });

  return (
    <Sheet
      open={open}
      onClose={close}
      heading={isMenu ? MENU_HEADING : RECORD_HEADINGS[formMode]}
      dateNav={
        isMenu
          ? undefined
          : {
              date: labels.date,
              weekday: labels.weekday,
              onPrev: () => go(-1),
              onNext: () => go(1),
              canNext,
            }
      }
      footer={
        isMenu ? undefined : (
          <SaveFooter label="Зберегти" onSave={save} disabled={invalid} error={saveError} />
        )
      }
    >
      <span ref={anchor} hidden />
      <SwapBody mode={mode}>
        {isMenu ? (
          <CaptureMenu
            rows={captureMenuRows(data, date, today)}
            dateLine={captureMenuDateLine(date, today)}
            onPick={(m) => ui.openSheet(date, m)}
          />
        ) : (
          <>
            {show.workout && (
              <WorkoutBlock
                mode={formMode}
                draft={draft}
                errors={errors}
                set={set}
                customTypes={data.settings.customTypes}
              />
            )}
            {show.food && (
              <FoodBlock
                mode={formMode}
                draft={draft}
                errors={errors}
                set={set}
                update={update}
                onFoodPending={onFoodPending}
                sheetKey={key}
                date={date}
                data={data}
              />
            )}
            {show.weight && (
              <WeightField
                label={formMode === 'day' ? 'Вага (за бажанням)' : 'Вага'}
                hint={weightHint(data, date)}
                name="weight"
                value={draft.weight}
                onChange={(weight) => set({ weight })}
                base={stepBaseWeight(data, date)}
                error={errors.weight}
              />
            )}
            {show.measure && (
              <MeasureField
                label={formMode === 'day' ? 'Заміри (за бажанням)' : 'Груди · талія · стегна'}
                values={draft}
                placeholders={measurePlaceholders(data, date)}
                onChange={onMeasure}
                error={errors.measure}
              />
            )}
            {show.notes && (
              <NotesBlock
                value={draft.notes}
                onChange={(notes) => set({ notes })}
                error={errors.notes}
                foldable={formMode === 'workout'}
                hadNotes={baseline.notes !== ''}
                sheetKey={key}
              />
            )}
          </>
        )}
      </SwapBody>
    </Sheet>
  );
}

/**
 * The body of one mode (keyed by it). Rendered inside the Sheet, so it lives exactly as long as the
 * open dialog: the body fades in only when it replaces another one in that dialog (not on the
 * sheet's own slide-up), then the new body starts at its top, and focus that fell to <body> with the
 * tapped menu row goes to the dialog (focus the new content took itself, e.g. `autoFocus`, stays).
 */
function SwapBody({ mode, children }: { mode: CaptureMode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [first] = useState(mode);
  const [swapped, setSwapped] = useState(false);
  if (!swapped && mode !== first) setSwapped(true);

  const shownMode = useRef(mode);
  useLayoutEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    const panel = ref.current?.closest<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    panel.scrollTop = 0;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) panel.focus({ preventScroll: true });
  }, [mode]);

  return (
    <div ref={ref} key={mode} className={cx(s.swap, swapped && s.enter)}>
      {children}
    </div>
  );
}

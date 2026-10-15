import { addDays, type MeasureKey } from '@legko/shared';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { MealEditorBody, MealSheet, useMealEditor, type MealTarget } from '@/features/food';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { cx, Sheet } from '@/ui';
import { MeasureField, SAVE_FAILED, SaveFooter, WeightField } from '../fields/fields';
import { measurePlaceholders, sheetDateLabels, stepBaseWeight, weightHint } from '../helpers';
import { useDraft } from '../useDraft';
import { useSheetGuard } from '../useSheetGuard';
import { NotesBlock, WorkoutBlock } from './blocks';
import { CaptureMenu } from './CaptureMenu';
import { AddMealButton, FoodDayPanel } from './FoodDayPanel';
import { foodDayModel } from './foodDayModel';
import { captureMenuDateLine, captureMenuRows } from './menuModel';
import {
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

/** The meal editor stacked over «Їжа» / «Запис дня», and the open sheet (`SheetState.key`) it belongs to. */
interface StackedMeal {
  sheetKey: number;
  target: MealTarget;
}

/**
 * The «+» menu «Що записати?» and every record form — «Запис дня», «Їжа» (the day's meals), «Прийом їжі» (a new
 * meal), «Тренування», «Контрольне зважування», «Заміри тіла» (prototype lines 425–510) — in ONE <Sheet>: a menu row
 * swaps heading, date navigator, footer and body of the same dialog in place (no second slide-up, no backdrop
 * flicker; the scroll lock and focus return to «+» stay with the one sheet). So never key this component or its
 * Sheet by mode. A meal opened from «Їжа» or «Запис дня» stacks above it (`MealSheet`, rendered inside this sheet).
 */
export function RecordSheet({ state, open }: RecordSheetProps) {
  const { date, mode, key } = state;
  const isMenu = mode === 'menu';
  const isMeal = mode === 'meal';
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

  // «Прийом їжі»: the new-meal editor of this sheet (idle in the other modes). ‹ › keep `key`, so the draft
  // moves to the other day with her.
  const meal = useMealEditor(isMeal ? { date, mealId: null, key } : null);

  // A meal row or «+ Прийом їжі» in «Їжа» / «Запис дня» opens the stacked editor. A new open of this sheet
  // (‹ ›, a deep link) leaves it behind.
  const [stacked, setStacked] = useState<StackedMeal | null>(null);
  const mealTarget = stacked !== null && stacked.sheetKey === key ? stacked.target : null;
  const opens = useRef(0);
  const openMeal = (mealId: string | null) => {
    opens.current += 1;
    const target: MealTarget = { date, mealId, key: opens.current };
    // Inside the tap: a new meal's «Що я їла» takes focus at once, so the iPhone keyboard opens with it.
    flushSync(() => setStacked({ sheetKey: key, target }));
  };

  // The draft the store refused to save; the message stays until she edits it.
  const [refused, setRefused] = useState<RecordDraft | null>(null);
  const saveError = refused === draft ? SAVE_FAILED : undefined;

  const show = recordSections(formMode);
  const errors = validateRecord(draft, formMode);
  const invalid = hasRecordErrors(errors);
  // The stacked editor asks for itself on ✕ / Escape / drag (it is the live sheet); a notification tap meanwhile
  // goes through this sheet's guard, so it asks too rather than dropping a meal she may be typing.
  const { anchor, close, guard, replace } = useSheetGuard(dirty || meal.dirty || mealTarget !== null, open);
  const labels = sheetDateLabels(date, today);
  const canNext = date < today;

  // ‹ › keep the sheet's mode; a new meal's draft moves with her (nothing typed is lost, nothing is asked).
  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    const next = addDays(date, delta);
    if (isMeal) ui.moveSheet(next);
    else guard(() => ui.openSheet(next, formMode));
  };

  const pick = (m: RecordMode) => {
    // Rendered inside the tap, so the new meal's «Що я їла» takes focus and the iPhone keyboard comes up.
    if (m === 'meal') flushSync(() => ui.openSheet(date, 'meal'));
    else ui.openSheet(date, m);
  };

  const done = () => {
    ui.closeSheet();
    ui.flash('Збережено');
  };

  const save = () => {
    if (!open || isMenu) return;
    if (isMeal) {
      if (meal.save()) done();
      return;
    }
    if (invalid) return;
    // The workout, notes, weigh-in and measurements; every meal saves on its own in the meal editor.
    if (!commit(...recordOps({ baseline, draft, data, date, mode: formMode }))) {
      setRefused(draft);
      return;
    }
    done();
  };

  const onMeasure = (field: MeasureKey, text: string) =>
    update((d) => {
      const next = { ...d };
      next[field] = text;
      return next;
    });

  const food = show.food ? foodDayModel(data, date) : null;

  let footer: ReactNode;
  if (isMenu) footer = undefined;
  else if (isMeal)
    footer = (
      <SaveFooter
        label="Зберегти"
        onSave={save}
        disabled={!meal.canSave}
        error={meal.saveError}
        hint={meal.saveHint}
      />
    );
  else if (formMode === 'food')
    footer = <AddMealButton canAdd={food?.canAdd ?? true} variant="solid" onAdd={() => openMeal(null)} />;
  else footer = <SaveFooter label="Зберегти" onSave={save} disabled={invalid} error={saveError} />;

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
      footer={footer}
    >
      <span ref={anchor} hidden />
      <SwapBody mode={mode}>
        {isMenu ? (
          <CaptureMenu
            rows={captureMenuRows(data, date, today)}
            dateLine={captureMenuDateLine(date, today)}
            onPick={pick}
          />
        ) : isMeal ? (
          <MealEditorBody editor={meal} onShowDay={() => replace(() => ui.openSheet(date, 'food'))} />
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
            {food && (
              <FoodDayPanel
                model={food}
                variant={formMode === 'food' ? 'sheet' : 'field'}
                onOpenMeal={openMeal}
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
      {/* Inside this sheet's content, so it stacks above it (and its item editor above it in turn). */}
      <MealSheet target={mealTarget} onClose={() => setStacked(null)} />
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

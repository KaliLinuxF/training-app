import { addDays, LIMITS, type MeasureKey } from '@legko/shared';
import { useCallback, useId, useState } from 'react';
import { FoodAssist, PhotoStrip, type FoodAdd } from '@/features/food';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { Field, Sheet, TextArea, TrainingToggle } from '@/ui';
import { FieldError, KcalField, MeasureField, SAVE_FAILED, SaveFooter, WeightField } from '../fields/fields';
import { measurePlaceholders, sheetDateLabels, stepBaseWeight, weightHint } from '../helpers';
import { useDraft } from '../useDraft';
import { useSheetGuard } from '../useSheetGuard';
import {
  applyFoodAdd,
  foodUseOps,
  hasRecordErrors,
  initRecordDraft,
  isRecordDirty,
  RECORD_HEADINGS,
  recordOps,
  recordSections,
  removePhoto,
  validateRecord,
  type RecordDraft,
  type RecordMode,
} from './model';
import { TypePicker } from './TypePicker';

export interface RecordSheetProps {
  state: SheetState & { mode: RecordMode };
  open: boolean;
}

/** Food text grows up to this many rows before it scrolls (estimate lines make it long). */
const FOOD_MAX_ROWS = 8;
const NOTES_MAX_ROWS = 6;

/** «Запис дня» / «Контрольне зважування» / «Заміри тіла» (prototype lines 425–510). */
export function RecordSheet({ state, open }: RecordSheetProps) {
  const { date, mode, key } = state;
  const data = useAppData();
  const today = useToday();
  // `current` lets an untouched draft follow a server refresh (another device's changes).
  const { draft, baseline, dirty, update } = useDraft<RecordDraft>(key, {
    init: () => ({
      baseline: initRecordDraft(data, date, mode),
      draft: initRecordDraft(data, date, mode, state.patch),
    }),
    current: initRecordDraft(data, date, mode),
    differs: isRecordDirty,
  });
  const set = (patch: Partial<RecordDraft>) => update((d) => ({ ...d, ...patch }));

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

  const show = recordSections(mode);
  const errors = validateRecord(draft, mode);
  const invalid = hasRecordErrors(errors);
  const { anchor, close, guard } = useSheetGuard(dirty || foodPending, open);
  const labels = sheetDateLabels(date, today);
  const canNext = date < today;
  const foodErrId = useId();
  const notesErrId = useId();
  const typesErrId = useId();

  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    guard(() => ui.openSheet(addDays(date, delta), mode));
  };

  const save = () => {
    if (!open || invalid) return;
    const ops = recordOps({ baseline, draft, data, date, mode });
    if (show.day) ops.push(...foodUseOps(draft, date));
    if (!commit(...ops)) {
      setRefused(draft);
      return;
    }
    ui.closeSheet();
    ui.flash('Збережено');
  };

  const onTrained = (trained: boolean) => set(trained ? { trained } : { trained, types: [] });
  const onFoodAdd = (add: FoodAdd) => update((d) => applyFoodAdd(d, add));
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
      heading={RECORD_HEADINGS[mode]}
      dateNav={{
        date: labels.date,
        weekday: labels.weekday,
        onPrev: () => go(-1),
        onNext: () => go(1),
        canNext,
      }}
      footer={<SaveFooter label="Зберегти" onSave={save} disabled={invalid} error={saveError} />}
    >
      <span ref={anchor} hidden />
      {show.day && (
        <>
          <Field label="Тренування">
            <TrainingToggle size="lg" value={draft.trained} onChange={onTrained} />
            {draft.trained === true && (
              <TypePicker
                selected={draft.types}
                customTypes={data.settings.customTypes}
                onChange={(types) => set({ types })}
              />
            )}
            <FieldError id={typesErrId} message={errors.types} />
          </Field>
          <Field label="Що я їла">
            <TextArea
              rows={3}
              autoGrowMaxRows={FOOD_MAX_ROWS}
              maxLength={LIMITS.text}
              name="food"
              placeholder="Сніданок, обід, вечеря, перекуси…"
              value={draft.food}
              onChange={(text) => set({ food: text })}
              aria-invalid={errors.food ? true : undefined}
              aria-errormessage={errors.food ? foodErrId : undefined}
            />
            <FieldError id={foodErrId} message={errors.food} />
            <PhotoStrip ids={draft.photos} size="md" onRemove={(id) => update((d) => removePhoto(d, id))} />
            <FoodAssist
              key={key}
              date={date}
              foodText={draft.food}
              onAdd={onFoodAdd}
              onPendingChange={onFoodPending}
            />
          </Field>
          <KcalField label="Калорії за день" name="kcal" value={draft.kcal} onChange={(kcal) => set({ kcal })} error={errors.kcal} />
        </>
      )}
      {show.weight && (
        <WeightField
          label={mode === 'day' ? 'Вага (за бажанням)' : 'Вага'}
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
          label={mode === 'day' ? 'Заміри (за бажанням)' : 'Груди · талія · стегна'}
          values={draft}
          placeholders={measurePlaceholders(data, date)}
          onChange={onMeasure}
          error={errors.measure}
        />
      )}
      {show.day && (
        <Field label="Нотатки">
          <TextArea
            rows={2}
            autoGrowMaxRows={NOTES_MAX_ROWS}
            maxLength={LIMITS.text}
            name="notes"
            placeholder="Самопочуття, вода, сон…"
            value={draft.notes}
            onChange={(notes) => set({ notes })}
            aria-invalid={errors.notes ? true : undefined}
            aria-errormessage={errors.notes ? notesErrId : undefined}
          />
          <FieldError id={notesErrId} message={errors.notes} />
        </Field>
      )}
    </Sheet>
  );
}

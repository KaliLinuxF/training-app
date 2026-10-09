import { addDays, type MeasureKey } from '@legko/shared';
import { FoodAssist, PhotoStrip, type FoodAdd } from '@/features/food';
import { useToday } from '@/lib/useToday';
import { commit, useAppData } from '@/store/data';
import { ui, type SheetState } from '@/store/ui';
import { Button, Field, Sheet, TextArea, TrainingToggle } from '@/ui';
import { KcalField, MeasureField, WeightField } from '../fields/fields';
import { latestWeight, measurePlaceholders, sheetDateLabels, weightHint } from '../helpers';
import { useDraft } from '../useDraft';
import { useSheetGuard } from '../useSheetGuard';
import {
  applyFoodAdd,
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

/** «Запис дня» / «Контрольне зважування» / «Заміри тіла» (prototype lines 425–510). */
export function RecordSheet({ state, open }: RecordSheetProps) {
  const { date, mode } = state;
  const data = useAppData();
  const today = useToday();
  const { draft, baseline, update } = useDraft<RecordDraft>(state.key, () => ({
    baseline: initRecordDraft(data, date, mode),
    draft: initRecordDraft(data, date, mode, state.patch),
  }));
  const set = (patch: Partial<RecordDraft>) => update((d) => ({ ...d, ...patch }));

  const show = recordSections(mode);
  const errors = validateRecord(draft, mode);
  const invalid = hasRecordErrors(errors);
  const { anchor, close, guard } = useSheetGuard(isRecordDirty(baseline, draft));
  const labels = sheetDateLabels(date, today);
  const canNext = date < today;

  const go = (delta: number) => {
    if (delta > 0 && !canNext) return;
    guard(() => ui.openSheet(addDays(date, delta), mode));
  };

  const save = () => {
    if (!open || invalid) return;
    commit(...recordOps(draft, date, mode));
    ui.closeSheet();
    ui.flash('Збережено');
  };

  const onTrained = (trained: boolean) => set(trained ? { trained } : { trained, types: [] });
  const onFoodAdd = (add: FoodAdd) => update((d) => applyFoodAdd(d, add));
  const onMeasure = (key: MeasureKey, text: string) =>
    update((d) => {
      const next = { ...d };
      next[key] = text;
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
      footer={
        <Button size="lg" fullWidth onClick={save} disabled={invalid}>
          Зберегти
        </Button>
      }
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
          </Field>
          <Field label="Що я їла">
            <TextArea
              rows={3}
              name="food"
              placeholder="Сніданок, обід, вечеря, перекуси…"
              value={draft.food}
              onChange={(food) => set({ food })}
            />
            <PhotoStrip ids={draft.photos} size="md" onRemove={(id) => update((d) => removePhoto(d, id))} />
            <FoodAssist date={date} onAdd={onFoodAdd} />
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
          base={latestWeight(data)}
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
            name="notes"
            placeholder="Самопочуття, вода, сон…"
            value={draft.notes}
            onChange={(notes) => set({ notes })}
          />
        </Field>
      )}
    </Sheet>
  );
}

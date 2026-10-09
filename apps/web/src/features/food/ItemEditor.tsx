import { f0, LIMITS, type FoodItem } from '@legko/shared';
import {
  useId,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { ui, type ConfirmOptions } from '@/store/ui';
import { Button, Chip, ChipGroup, cx, Field, Sheet, useFieldA11y, useRetained } from '@/ui';
import { focusFirst } from './focus';
import {
  canSave,
  canStep,
  dishSuggestions,
  editorChanged,
  kcalNote,
  kcalSource,
  multiplierChoices,
  restorableName,
  unitChoices,
  type EditorAction,
  type ItemEditorState,
} from './itemEditorModel';
import { parseKcal } from './model';
import { parseAmount, unitForm } from './portion';
import s from './ItemEditor.module.css';

/** ✕ / Escape / backdrop / drag-down on a changed draft. */
export const DISCARD_ITEM_CONFIRM: Readonly<ConfirmOptions> = {
  title: 'Скасувати зміни?',
  confirmLabel: 'Скасувати зміни',
  cancelLabel: 'Залишитись',
  destructive: true,
};

export interface ItemEditorProps {
  /** The open editor; null closes the sheet (its content stays during the exit animation). */
  state: ItemEditorState | null;
  /** «Часті страви» the name field suggests. */
  foods: readonly FoodItem[];
  /** A recalculation is running («Рахую…»; «Додати» and «Перерахувати» wait for it). */
  recalculating?: boolean;
  /** It was asked for in this editor: «Рахую…» stays even if she has undone the change meanwhile. */
  recalcAskedHere?: boolean;
  /** Why the last recalculation asked for in this editor failed (inline alert). */
  recalcError?: string;
  /** Why the model cannot be asked right now (offline, no estimates left): kcal by hand only. */
  blockedReason?: string | null;
  /** The name field («+ позиція» focuses it inside the tap, so the iPhone keyboard opens). */
  nameRef?: Ref<HTMLInputElement>;
  /** The fields' wrapper inside the sheet (the card checks whether focus is still in the editor). */
  bodyRef?: RefObject<HTMLDivElement | null>;
  onChange: (action: EditorAction) => void;
  /** «Готово» / «Додати позицію». */
  onSave: () => void;
  /** The draft is dropped (closed unchanged, or she confirmed). */
  onDiscard: () => void;
  /** «Видалити позицію». */
  onRemove: (itemId: string) => void;
  /** «✨ Перерахувати» with this draft in place of its row. */
  onRecalculate: () => void;
}

/**
 * «Позиція» / «Нова позиція»: one estimate row in a second sheet over the day sheet (a centred
 * modal on desktop) with large controls — what it is, how much, how many kcal. Works on a local
 * draft: «Готово» applies it, ✕ drops it (asking first when something changed). While the kcal
 * wait for the model, «✨ Перерахувати» sits in the footer next to «Готово»: always in view, even
 * when the fields scroll under it.
 */
export function ItemEditor({
  state,
  foods,
  recalculating = false,
  recalcAskedHere = false,
  recalcError,
  blockedReason = null,
  nameRef,
  bodyRef,
  onChange,
  onSave,
  onDiscard,
  onRemove,
  onRecalculate,
}: ItemEditorProps) {
  const shown = useRetained(state);
  const ownBodyRef = useRef<HTMLDivElement>(null);
  const body = bodyRef ?? ownBodyRef;
  const saveRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLButtonElement>(null);
  const blockedId = useId();
  const isNew = shown?.original === null;
  const blocked = blockedReason !== null;
  // While her request runs it stays, as «Рахую…», even if she has undone the change meanwhile.
  const aiShown =
    (shown !== null && kcalSource(shown).kind === 'needsAi') || (recalculating && recalcAskedHere);
  // One line when the alert says what the hint would (a 429 on her «Перерахувати»).
  const blockedInAlert = blocked && recalcError === blockedReason;

  // «✨ Перерахувати» goes away once the model answered (or nothing needs it): her focus moves on
  // to «Готово» next to it, else «Вписати вручну», else the dialog (not into a field: that would
  // pop up the keyboard). Only within one open editor — not when it opens on the next row.
  const shownAi = useRef({ id: shown?.item.id, open: state !== null, ai: aiShown });
  useLayoutEffect(() => {
    const was = shownAi.current;
    const now = { id: shown?.item.id, open: state !== null, ai: aiShown };
    shownAi.current = now;
    if (!was.ai || now.ai || !was.open || !now.open || was.id !== now.id) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    focusFirst([saveRef.current, manualRef.current, body.current?.closest<HTMLElement>('[role="dialog"]')]);
  });

  const close = () => {
    if (!state) return;
    if (!editorChanged(state)) {
      onDiscard();
      return;
    }
    void ui.confirm({ ...DISCARD_ITEM_CONFIRM }).then((ok) => {
      if (ok) onDiscard();
      else restorePanel(body.current);
    });
  };

  const save = () => {
    if (state && canSave(state)) onSave();
  };

  // Never natively disabled: locked under her focus (a 429, offline) it would drop it to <body>.
  const recalculate = () => {
    if (!recalculating && !blocked) onRecalculate();
  };

  return (
    <Sheet
      open={state !== null}
      onClose={close}
      heading={isNew ? 'Нова позиція' : 'Позиція'}
      size="compact"
      footer={
        <div className={cx(s.footer, aiShown && s.pair)}>
          {aiShown && (
            <button
              type="button"
              className={cx(s.recalc, recalculating && s.busy)}
              aria-disabled={recalculating || blocked || undefined}
              aria-describedby={blocked ? blockedId : undefined}
              onClick={recalculate}
            >
              {recalculating ? (
                'Рахую…'
              ) : (
                <>
                  <span aria-hidden="true">✨</span>{' '}
                  {isNew && !shown?.item.base ? 'Порахувати' : 'Перерахувати'}
                </>
              )}
            </button>
          )}
          <Button
            ref={saveRef}
            size="lg"
            fullWidth
            className={s.save}
            disabled={!shown || !canSave(shown)}
            onClick={save}
          >
            {isNew ? 'Додати позицію' : 'Готово'}
          </Button>
        </div>
      }
    >
      <div ref={body} className={s.fields}>
        {shown && (
          <ItemFields
            // Another row: fresh field ids and focus bookkeeping.
            key={shown.item.id}
            state={shown}
            foods={foods}
            recalcError={recalcError}
            blockedHint={blocked && aiShown && !blockedInAlert ? blockedReason : null}
            blockedId={blockedId}
            alertIsBlockedHint={blockedInAlert}
            nameRef={nameRef}
            manualRef={manualRef}
            onChange={onChange}
            onRemove={onRemove}
          />
        )}
      </div>
    </Sheet>
  );
}

/**
 * The kit's drag-to-dismiss slides the panel out before asking; when she stays, slide it back
 * (the inline transform is the only thing holding it down).
 */
function restorePanel(anchor: HTMLElement | null): void {
  const panel = anchor?.closest<HTMLElement>('[role="dialog"]');
  if (!panel) return;
  panel.style.transition = '';
  panel.style.transform = '';
}

/** «Готово» on the iPhone keyboard just closes it; never submits anything around the editor. */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/** A text field labelled by the <Field> around it (and described by its hint), or explicitly. */
function FieldInput({
  'aria-label': label,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  className,
  ...rest
}: ComponentPropsWithRef<'input'>) {
  const a11y = useFieldA11y({
    'aria-label': label,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  });
  return (
    <input
      type="text"
      autoComplete="off"
      enterKeyHint="done"
      className={cx(s.input, className)}
      onKeyDown={blurOnEnter}
      {...rest}
      {...a11y}
    />
  );
}

interface ItemFieldsProps {
  state: ItemEditorState;
  foods: readonly FoodItem[];
  recalcError: string | undefined;
  /** Why «Перерахувати» is locked, when the alert does not already say it. */
  blockedHint: string | null;
  /** Id the footer's «Перерахувати» is described by: the hint, or the alert that says the same. */
  blockedId: string;
  alertIsBlockedHint: boolean;
  nameRef: Ref<HTMLInputElement> | undefined;
  manualRef: Ref<HTMLButtonElement>;
  onChange: (action: EditorAction) => void;
  onRemove: (itemId: string) => void;
}

function ItemFields({
  state,
  foods,
  recalcError,
  blockedHint,
  blockedId,
  alertIsBlockedHint,
  nameRef,
  manualRef,
  onChange,
  onRemove,
}: ItemFieldsProps) {
  const { item } = state;
  const isNew = state.original === null;
  const howMuchId = useId();
  const unitId = useId();
  const kcalId = useId();
  const portionTextRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const kcalInputRef = useRef<HTMLInputElement>(null);
  const unitsRef = useRef<HTMLDivElement>(null);

  const suggestions = dishSuggestions(foods, state);
  const restore = restorableName(state);
  const source = kcalSource(state);
  const note = kcalNote(source);
  const amount = parseAmount(state.amountText);
  const kcal = item.kcalText === '' ? null : parseKcal(item.kcalText);

  // The unit chips scroll sideways on a phone: keep the chosen one in view (a dish's «чашка» comes
  // after the basic units).
  useLayoutEffect(() => {
    const row = unitsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && chip) scrollIntoRow(row, chip);
  }, [state.unit, state.textMode]);

  /** Switches between the amount controls and the free-text portion, focus following. */
  const setTextMode = (on: boolean) => {
    flushSync(() => onChange({ type: 'textMode', on }));
    (on ? portionTextRef : amountRef).current?.focus();
  };

  const typeKcal = () => {
    flushSync(() => onChange({ type: 'manualKcal' }));
    // Inside the tap: the iPhone opens the keyboard only then.
    kcalInputRef.current?.focus();
    kcalInputRef.current?.select();
  };

  const step = (dir: 1 | -1) => {
    if (canStep(state, dir)) onChange({ type: 'step', dir });
  };

  return (
    <>
      <Field
        label="Що це"
        hint={!isNew && item.name.trim() === '' ? 'Без назви позицію не зберегти' : undefined}
      >
        <FieldInput
          ref={nameRef}
          className={s.name}
          value={item.name}
          placeholder="Напр.: сирники зі сметаною"
          maxLength={LIMITS.foodName}
          // Only a new row: on a row she opened, the keyboard would cover what she came to change.
          autoFocus={isNew}
          onChange={(e) => onChange({ type: 'name', value: e.target.value })}
        />
        {(suggestions.length > 0 || restore !== null) && (
          <div className={s.suggestions} role="group" aria-label="Підказки">
            {restore !== null && (
              <button
                type="button"
                className={cx(s.suggestion, s.restore)}
                onClick={() => onChange({ type: 'restoreName' })}
              >
                <span className={s.suggestionName}>повернути: {restore}</span>
              </button>
            )}
            {suggestions.map((dish) => (
              <button
                key={dish.name}
                type="button"
                className={s.suggestion}
                aria-label={[dish.name, dish.portion, `${f0(dish.kcal)} ккал`].filter(Boolean).join(', ')}
                onClick={() => onChange({ type: 'dish', dish })}
              >
                <span className={s.suggestionName}>{dish.name}</span>
                <span className={s.suggestionKcal}>· {f0(dish.kcal)}</span>
              </button>
            ))}
          </div>
        )}
      </Field>

      {/* «Скільки»: like a <Field>, with the switch to a text portion on the label's line. */}
      <div className={s.howMuch}>
        <div className={s.howMuchHead}>
          <span id={howMuchId} className={s.label}>
            Скільки
          </span>
          <button type="button" className={s.modeLink} onClick={() => setTextMode(!state.textMode)}>
            {state.textMode ? 'Вказати кількістю' : 'Порція текстом'}
          </button>
        </div>
        {state.textMode ? (
          <FieldInput
            ref={portionTextRef}
            className={s.portionText}
            value={item.portion}
            placeholder="напр. 2 ст. л."
            maxLength={LIMITS.portion}
            autoCapitalize="none"
            autoCorrect="off"
            aria-labelledby={howMuchId}
            onChange={(e) => onChange({ type: 'portionText', value: e.target.value })}
          />
        ) : (
          <>
            <div className={s.amount}>
              <button
                type="button"
                className={s.step}
                aria-label="Зменшити"
                aria-disabled={!canStep(state, -1) || undefined}
                onClick={() => step(-1)}
              >
                <span aria-hidden="true">−</span>
              </button>
              <div className={s.amountWrap}>
                <FieldInput
                  ref={amountRef}
                  className={s.amountInput}
                  inputMode="decimal"
                  value={state.amountText}
                  placeholder="0"
                  aria-labelledby={howMuchId}
                  aria-describedby={unitId}
                  onChange={(e) => onChange({ type: 'amount', text: e.target.value })}
                  onFocus={(e) => e.target.select()}
                />
                <span id={unitId} className={s.unit}>
                  {unitForm(state.unit, amount ?? 1)}
                </span>
              </div>
              <button
                type="button"
                className={s.step}
                aria-label="Збільшити"
                aria-disabled={!canStep(state, 1) || undefined}
                onClick={() => step(1)}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            <div ref={unitsRef} className={s.unitsScroll}>
              <ChipGroup aria-label="Одиниця" className={s.units}>
                {unitChoices(state).map((unit) => (
                  <Chip
                    key={unit}
                    selected={unit === state.unit}
                    className={s.chip}
                    onClick={() => onChange({ type: 'unit', unit })}
                  >
                    {unit}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
            <Multipliers state={state} onChange={onChange} />
          </>
        )}
      </div>

      <Field label="Калорії">
        {state.manualKcal ? (
          <div className={s.kcalField}>
            <FieldInput
              ref={kcalInputRef}
              className={s.kcalInput}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              value={item.kcalText}
              placeholder="0"
              aria-describedby={note ? kcalId : undefined}
              onChange={(e) => onChange({ type: 'kcal', value: e.target.value })}
              onFocus={(e) => e.target.select()}
            />
            <span className={s.kcalUnit}>ккал</span>
          </div>
        ) : (
          <p className={s.kcal} aria-live="polite" aria-atomic="true">
            {kcal === null ? '—' : f0(kcal)} <span className={s.kcalUnit}>ккал</span>
          </p>
        )}
        {note && (
          <p id={kcalId} className={cx(s.note, source.kind === 'needsAi' && s.noteTag)}>
            {note}
          </p>
        )}
        {blockedHint !== null && (
          <p id={blockedId} className={s.hint}>
            {blockedHint} — калорії можна вписати вручну
          </p>
        )}
        {recalcError && (
          <p id={alertIsBlockedHint ? blockedId : undefined} className={s.error} role="alert">
            {recalcError}
          </p>
        )}
        {!state.manualKcal && (
          <Button ref={manualRef} variant="ghost" className={s.manual} onClick={typeKcal}>
            Вписати вручну
          </Button>
        )}
      </Field>

      {!isNew && (
        // Apart from the rest: it drops a row the model priced (getting it back costs a new request).
        <div className={s.danger}>
          <Button variant="outline" fullWidth className={s.remove} onClick={() => onRemove(item.id)}>
            Видалити позицію
          </Button>
        </div>
      )}
    </>
  );
}

/** Scrolls a sideways-scrolling row (not the sheet) just enough to show `el` inside its padding. */
function scrollIntoRow(row: HTMLElement, el: HTMLElement): void {
  const box = row.getBoundingClientRect();
  if (box.width === 0) return;
  const r = el.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
  if (r.left < box.left + pad) row.scrollLeft -= box.left + pad - r.left;
  else if (r.right > box.right - pad) row.scrollLeft += r.right - (box.right - pad);
}

function Multipliers({
  state,
  onChange,
}: {
  state: ItemEditorState;
  onChange: (action: EditorAction) => void;
}) {
  const choices = multiplierChoices(state);
  if (!choices.length) return null;
  return (
    <ChipGroup aria-label="Від порції" className={s.multipliers}>
      {choices.map((m) => (
        <Chip
          key={m.factor}
          selected={m.active}
          className={s.chip}
          disabled={m.portion === null}
          aria-label={m.portion ? `${m.label} — ${m.portion}` : m.label}
          onClick={() => onChange({ type: 'multiply', factor: m.factor })}
        >
          {m.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}

import { dLong, DOW_LONG, LIMITS, weekdayOf, type FoodEstimateItem } from '@legko/shared';
import { useId, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useToday } from '@/lib/useToday';
import { useAppData, useSyncState } from '@/store/data';
import { Button, cx, TextArea, TimeInput } from '@/ui';
import { isNamed, MAX_ROWS, needsRecalc } from '../drafts';
import { EstimateCard, EstimateLoading } from '../EstimateCard';
import { ESTIMATE_MESSAGES } from '../errors';
import { liveNotice, type EstimateAction } from '../estimate';
import { FoodAssist, type AssistHint, type AssistMode } from '../FoodAssist';
import { focusFirst } from '../focus';
import { useFoodStatus } from '../foodStatus';
import { FrequentDishes } from '../FrequentDishes';
import { consumedTail, MAX_POSITIONS_HINT } from '../model';
import { PhotoStrip } from '../PhotoStrip';
import { ManualNumbers } from './ManualNumbers';
import {
  dayBudget,
  dishAction,
  hasPositions,
  LEGACY_HINT,
  MEAL_HINTS,
  mealChips,
  otherMealCount,
  nowHM,
  pendingTail,
  photoCapacity,
} from './mealModel';
import { MealTypeChips } from './MealTypeChips';
import type { MealEditor, MealSession } from './useMealEditor';
import s from './MealEditorBody.module.css';

export interface MealEditorBodyProps {
  editor: MealEditor;
  /** Mode 'meal' (menu / Home / calendar hosted) on a day with other meals: «Усі прийоми за день →» (host swaps to 'food', guarded). */
  onShowDay?: () => void;
  /** After «Видалити прийом» went through (the host closes). */
  onDeleted?: () => void;
  /** Stacked over «Їжа» / «Запис дня» (no date nav above): shows «13 жовтня · вівторок» when date ≠ today. */
  stacked?: boolean;
}

/** «Що я їла» rows: 2, growing to 6. */
const TEXT_ROWS = 2;
const TEXT_MAX_ROWS = 6;
const LIMIT_TEXT = 'Ліміт підрахунків на сьогодні вичерпано';
const OFFLINE_TEXT = 'Потрібен інтернет';

/** Row ids unique for the page's lifetime (a remounted body never reuses one). */
let rowCounter = 0;
const nextRowId = (prefix: string): string => `${prefix}${++rowCounter}`;

/**
 * The meal editor «Прийом їжі» (docs/meals-macros.md §7.3): type chips, the AI row above «Що я їла»
 * (so the iPhone keyboard never covers it), the text, photos, positions or manual kcal / Б · Ж · В,
 * «Часті страви», the day's total, time, delete. Hosted by a sheet (its footer holds «Зберегти»).
 */
export function MealEditorBody({ editor, ...rest }: MealEditorBodyProps) {
  const { session } = editor;
  if (!session) return null;
  return (
    <MealForm key={`${session.key}:${session.draft.id}`} session={session} remove={editor.remove} {...rest} />
  );
}

interface MealFormProps extends Omit<MealEditorBodyProps, 'editor'> {
  session: MealSession;
  remove: () => Promise<boolean>;
}

function MealForm({ session, remove, onShowDay, onDeleted, stacked = false }: MealFormProps) {
  const data = useAppData();
  const today = useToday();
  const status = useFoodStatus();
  const { online } = useSyncState();
  const { draft, date, dispatch, validation } = session;
  const p = draft.positions;

  const textId = useId();
  const blockedId = useId();
  const countHintId = useId();
  const photoHintId = useId();
  const rowsCapId = useId();
  const timeId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const photoRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const addTimeRef = useRef<HTMLButtonElement>(null);
  /** The last estimate was a photo: focus goes back to «📷 Фото» rather than the first button. */
  const lastPhoto = useRef(false);

  const aiShown = status?.enabled === true;
  const exhausted = aiShown && status.remainingToday <= 0;
  const rowsFull = p.drafts.length >= MAX_ROWS;
  const busy = p.loading !== null || p.recalc.pending !== null;
  const named = p.drafts.some(isNamed);
  const tail = pendingTail(draft);
  const composerOpen = draft.composer.open;
  const mode: AssistMode = composerOpen ? 'more' : tail ? 'rest' : named ? 'more' : 'count';

  const offline = !online ? OFFLINE_TEXT : exhausted ? LIMIT_TEXT : null;
  const blockedText = offline ?? (rowsFull ? MAX_POSITIONS_HINT : null);
  const blocked: AssistHint | undefined = blockedText ? { id: blockedId, text: blockedText } : undefined;
  // A 429 on «Перерахувати»: the card's alert says it and takes over the line's id.
  const blockedInCard = blocked !== undefined && p.recalc.error === blocked.text;
  const capacity = photoCapacity(data, date, draft);
  const photoHint: AssistHint | undefined =
    draft.photos.length >= capacity ? { id: photoHintId, text: MEAL_HINTS.photoCap } : undefined;
  const countHint: AssistHint | undefined =
    mode === 'count' && !draft.text.trim() ? { id: countHintId, text: 'Опиши, що їла' } : undefined;
  // Without the AI (off on the server, or not known yet) a renamed «Часті страви» row cannot be priced either.
  const recalcText = offline ?? (aiShown ? null : ESTIMATE_MESSAGES.ai_unavailable);
  const recalcBlocked = recalcText ? { id: blockedId, text: recalcText } : undefined;
  // The AI row (which says why) is not there: the card's «Перерахувати» needs its own line.
  const recalcLine = !aiShown && recalcBlocked !== undefined && p.drafts.some(needsRecalc);
  const rowsHintId = aiShown && blockedText === MAX_POSITIONS_HINT ? blockedId : rowsCapId;

  const budget = dayBudget(data, date, draft);
  const others = otherMealCount(data, date, draft);
  const live = liveNotice(p);

  // The control she was on (the AI button, «Скасувати», the composer) goes away as a request starts
  // or ends: move focus to what replaced it — «Скасувати» while it runs, the card's title with the
  // result, else back where she started — unless she is working in another field by now.
  const loadingId = p.loading?.id ?? null;
  const shownLoading = useRef(loadingId);
  useLayoutEffect(() => {
    const was = shownLoading.current;
    shownLoading.current = loadingId;
    if (was === loadingId || !focusNear([aiRef.current, positionsRef.current], rootRef.current)) return;
    if (loadingId !== null) {
      focusFirst([cancelRef.current]);
      return;
    }
    if (p.notice?.key === `r${was}`) {
      focusFirst([titleRef.current, firstRef.current]);
      return;
    }
    const [one, two] = lastPhoto.current
      ? [photoRef.current, firstRef.current]
      : [firstRef.current, photoRef.current];
    focusFirst([composerOpen ? composerRef.current : null, one, two, rootRef.current]);
  }, [loadingId, p.notice, composerOpen]);

  const focusText = () => document.getElementById(textId)?.focus();
  const positions = (action: EstimateAction) => dispatch({ type: 'estimate', action });

  const count = () => {
    if (mode === 'count' && !draft.text.trim()) {
      // «Опиши, що їла»: straight to the text (the keyboard opens inside the tap).
      focusText();
      return;
    }
    lastPhoto.current = false;
    session.estimateText(mode === 'rest' ? tail : draft.text, draft.text);
  };

  const toggleComposer = () => {
    const opening = !composerOpen;
    flushSync(() => dispatch({ type: 'composer', open: opening }));
    if (opening) composerRef.current?.focus();
  };

  const submitComposer = () => {
    lastPhoto.current = false;
    // Left as pre-filled (the pending tail), it counts her text; typed anew, it is something else.
    session.estimateText(draft.composer.text, consumedTail(draft.composer) ? draft.text : null);
  };

  const photo = (file: File) => {
    lastPhoto.current = true;
    const hint = composerOpen ? draft.composer.text : named ? tail : draft.text;
    session.estimatePhoto(file, hint, !composerOpen && hint.trim() ? draft.text : null);
  };

  const undo = () => {
    flushSync(() => positions({ type: 'undo' }));
    focusFirst([firstRef.current, photoRef.current, rootRef.current]);
  };

  const addDish = (dish: FoodEstimateItem) => dispatch(dishAction(nextRowId('d'), dish));

  const addTime = () => {
    flushSync(() => dispatch({ type: 'time', value: nowHM() }));
    document.getElementById(timeId)?.focus();
  };

  const clearTime = () => {
    flushSync(() => dispatch({ type: 'time', value: null }));
    addTimeRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={s.form}>
      <div className={s.top}>
        {stacked && date !== today && (
          <p className={s.dateLine}>
            {dLong(date)} · {DOW_LONG[weekdayOf(date)]}
          </p>
        )}

        <MealTypeChips
          choices={mealChips(data.settings.mealTypes, draft)}
          selected={draft.type}
          onSelect={(value) => dispatch({ type: 'type', value })}
          onAdd={session.addType}
        />

        {aiShown && (
          <div ref={aiRef}>
            <FoodAssist
              mode={mode}
              tail={tail}
              blocked={blocked}
              blockedInCard={blockedInCard}
              countHint={countHint}
              photoHint={photoHint}
              busy={busy}
              error={p.error}
              composerOpen={composerOpen}
              composerText={draft.composer.text}
              firstRef={firstRef}
              photoRef={photoRef}
              composerRef={composerRef}
              onCount={count}
              onToggleComposer={toggleComposer}
              onComposerText={(text) => dispatch({ type: 'composerText', text })}
              onSubmitComposer={submitComposer}
              onPhoto={photo}
            />
          </div>
        )}

        <TextArea
          id={textId}
          rows={TEXT_ROWS}
          autoGrowMaxRows={TEXT_MAX_ROWS}
          maxLength={LIMITS.text}
          placeholder="Напр.: тост з тунцем, кава"
          aria-label="Що я їла"
          value={draft.text}
          // A new meal: focused inside the opening tap (the host opens it with flushSync), so the
          // iPhone keyboard opens; an existing one opens without the keyboard.
          autoFocus={draft.isNew}
          onChange={(value) => dispatch({ type: 'text', value })}
        />
        {tail && <p className={s.tail}>Ще не пораховано: {tail}</p>}
      </div>

      <PhotoStrip ids={draft.photos} size="md" onRemove={(id) => dispatch({ type: 'removePhoto', id })} />

      <div ref={positionsRef} className={s.positions}>
        {p.loading && (
          <EstimateLoading
            photo={p.loading.photo}
            preview={p.loading.preview}
            onCancel={session.cancelEstimate}
            cancelRef={cancelRef}
          />
        )}
        <EstimateCard
          drafts={p.drafts}
          comment={p.comment}
          showEmpty={p.emptyResult}
          remaining={status?.remainingToday ?? null}
          titleRef={titleRef}
          recalculating={p.recalc.pending !== null}
          recalcError={p.recalc.error}
          recalcInEditor={p.recalc.fromEditor === true}
          blockedHint={recalcBlocked}
          editor={p.editor}
          onUndo={p.undo ? undo : undefined}
          fallbackFocus={() =>
            firstRef.current ?? rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null
          }
          onOpenItem={(itemId) => positions({ type: 'openItem', itemId })}
          onNewItem={() => positions({ type: 'newItem', itemId: nextRowId('n') })}
          onEditorChange={(action) => positions({ type: 'editor', action })}
          onSaveItem={() => positions({ type: 'saveItem' })}
          onCloseItem={() => positions({ type: 'closeItem' })}
          onRemove={(itemId) => positions({ type: 'remove', itemId })}
          onRecalculate={session.recalculate}
        />
        {recalcLine && (
          <p id={blockedId} className={s.note}>
            {recalcBlocked.text}
          </p>
        )}
        {!hasPositions(draft) && (
          <ManualNumbers
            kcalText={draft.kcalText}
            macroTexts={draft.macroTexts}
            macrosOpen={draft.macrosOpen}
            kcalError={validation.kcal}
            macroError={validation.macro}
            onKcal={(value) => dispatch({ type: 'kcal', value })}
            onMacro={(key, value) => dispatch({ type: 'macro', key, value })}
            onOpenMacros={() => dispatch({ type: 'openMacros' })}
          />
        )}
      </div>

      <FrequentDishes onAdd={addDish} lockedBy={rowsFull ? rowsHintId : undefined} />
      {rowsFull && rowsHintId === rowsCapId && data.foods.length > 0 && (
        <p id={rowsCapId} className={s.hint}>
          {MAX_POSITIONS_HINT}
        </p>
      )}

      {(budget || (onShowDay && others > 0)) && (
        <div className={s.day}>
          {budget && <p className={cx(s.budget, budget.over && s.over)}>{budget.text}</p>}
          {onShowDay && others > 0 && (
            <Button variant="ghost" className={s.showDay} onClick={onShowDay}>
              Усі прийоми за день →
            </Button>
          )}
        </div>
      )}

      <div className={s.timeRow}>
        {draft.time !== null ? (
          <>
            <label htmlFor={timeId} className={s.timeLabel}>
              Час
            </label>
            <TimeInput
              id={timeId}
              className={s.time}
              value={draft.time}
              onChange={(value) => dispatch({ type: 'time', value })}
            />
            <button type="button" className={s.clearTime} aria-label="Прибрати час" onClick={clearTime}>
              <span aria-hidden="true">✕</span>
            </button>
          </>
        ) : (
          <Button ref={addTimeRef} variant="ghost" className={s.addTime} onClick={addTime}>
            + Час
          </Button>
        )}
      </div>

      {draft.legacy && draft.type === '' && <p className={s.legacy}>{LEGACY_HINT}</p>}

      {!draft.isNew && (
        // Apart from the rest, like «Видалити позицію» one sheet up: it drops the whole meal.
        <div className={s.danger}>
          <Button
            variant="outline"
            fullWidth
            className={s.remove}
            onClick={() => {
              void remove().then((ok) => {
                if (ok) onDeleted?.();
              });
            }}
          >
            Видалити прийом
          </Button>
        </div>
      )}

      {/* Always mounted, so changes are read out: progress, what was found, what was taken back. */}
      <div className="visually-hidden" role="status">
        {live && <span key={live.key}>{live.text}</span>}
      </div>
    </div>
  );
}

/**
 * Whether focus is somewhere a change in the AI row or the positions may take it from: inside one
 * of them, on an ancestor of the form (Safari focuses the dialog, not the tapped button), or lost
 * to <body>. Focus in any other control — «Що я їла» included — means she is working there.
 */
function focusNear(roots: readonly (HTMLElement | null)[], form: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (form && active.contains(form)) return true;
  return roots.some((root) => root?.contains(active));
}

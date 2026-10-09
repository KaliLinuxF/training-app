import type { ISODate, Op } from '@legko/shared';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useSyncState } from '@/store/data';
import { Button, cx } from '@/ui';
import { EstimateCard, EstimateLoading } from './EstimateCard';
import { useFoodEstimate, type EstimateDeps, type EstimatePhase } from './estimate';
import { focusFirst, focusIsAround } from './focus';
import { useFoodStatus } from './foodStatus';
import { FrequentDishes } from './FrequentDishes';
import {
  addedMessage,
  buildFoodAdd,
  COMPOSER_CLOSED,
  composerEdited,
  consumedTail,
  draftsToItems,
  foundMessage,
  openComposer,
  type ComposerState,
} from './model';
import { unestimatedTail } from './tail';
import type { FoodAdd } from './types';
import s from './FoodAssist.module.css';

export interface FoodAssistProps {
  /** Day being edited (sent with the estimate request). */
  date: ISODate;
  /** The day's «Що я їла» text: «✨ Порахувати» pre-fills the composer with its unestimated tail. */
  foodText: string;
  /**
   * She confirmed an estimate or tapped a frequent dish. The sheet inserts `add.line` (replacing
   * `add.consumed`, see `insertEstimate`), adds the kcal and records `add.uses` as `food.use` ops
   * when the day is saved. FoodAssist never commits `food.use` itself.
   */
  onAdd: (add: FoodAdd) => void;
  /**
   * Whether something here would be lost if the sheet closed or changed day: a request in flight,
   * a result not added yet, or composer text she typed herself. The sheet asks before dropping it.
   */
  onPendingChange?: (pending: boolean) => void;
  /** Test seams; the app uses the real API, store and toast. */
  estimateDeps?: EstimateDeps;
  /** Commits `food.delete` from «Часті страви» («Змінити» → ✕). */
  commit?: (...ops: Op[]) => boolean;
}

const PLACEHOLDER = 'Напр.: борщ 300 г, 2 скибки хліба, салат';

/** What is on screen in the AI block; focus follows it when it changes. */
type View = 'actions' | 'composer' | 'loading' | 'result';

interface Announcement {
  /** New key → new node → read out again, even when the text repeats («Додано 60 ккал» twice). */
  key: string;
  text: string;
}

/**
 * «✨ Порахувати» / «📷 Фото» + «Часті страви» block under the «Що я їла» textarea (SPEC §3.7).
 * The AI part is hidden when the server has no AI; the chips work offline.
 */
export function FoodAssist(props: FoodAssistProps) {
  // Another day in the sheet starts from scratch: no request, result, composer text or focus
  // bookkeeping carries over (the request is aborted on unmount).
  return <DayFoodAssist key={props.date} {...props} />;
}

function DayFoodAssist({ date, foodText, onAdd, onPendingChange, estimateDeps, commit }: FoodAssistProps) {
  const status = useFoodStatus();
  const { online } = useSyncState();
  const est = useFoodEstimate(date, estimateDeps);
  const [composer, setComposer] = useState<ComposerState>(COMPOSER_CLOSED);
  const [added, setAdded] = useState<Announcement | null>(null);
  const addSeq = useRef(0);
  /** Whether the last estimate was a photo: focus returns to «📷 Фото» rather than «✨ Порахувати». */
  const lastPhoto = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const photoRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const composerId = useId();
  const hintId = useId();

  const { phase } = est;
  const aiShown = status?.enabled === true;
  const exhausted = aiShown && status.remainingToday <= 0;
  const busy = phase.kind !== 'idle';
  const blocked = !online || exhausted;
  const hint = !online ? 'Потрібен інтернет' : exhausted ? 'Ліміт підрахунків на сьогодні вичерпано' : null;
  const error = phase.kind === 'idle' ? phase.error : undefined;
  const composerShown = composer.open && phase.kind === 'idle';
  const view: View =
    phase.kind === 'loading' ? 'loading' : phase.kind === 'result' ? 'result' : composerShown ? 'composer' : 'actions';
  const pending =
    phase.kind === 'loading' ||
    (phase.kind === 'result' && phase.drafts.length > 0) ||
    (composer.open && composerEdited(composer));
  const live = liveMessage(phase, added);

  // Tell the sheet what would be lost on close / day change.
  const pendingRef = useRef(onPendingChange);
  useEffect(() => {
    pendingRef.current = onPendingChange;
  });
  useEffect(() => {
    pendingRef.current?.(pending);
  }, [pending]);
  useEffect(() => () => pendingRef.current?.(false), []);

  // The element she was on (composer, «Скасувати», «Додати») unmounts as the block changes: move
  // focus to what replaced it, unless she is working in another control by now.
  const shownView = useRef(view);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    const root = rootRef.current;
    if (!root || !focusIsAround(root)) return;
    if (view === 'composer') focusFirst([composerRef.current]);
    else if (view === 'loading') focusFirst([cancelRef.current]);
    else if (view === 'result') focusFirst([titleRef.current]);
    else {
      const [first, second] = lastPhoto.current
        ? [photoRef.current, toggleRef.current]
        : [toggleRef.current, photoRef.current];
      focusFirst([first, second, root]);
    }
  }, [view]);

  const announceAdded = (add: FoodAdd) => setAdded({ key: `a${++addSeq.current}`, text: addedMessage(add) });

  const toggleComposer = () => {
    if (error) est.reset();
    setComposer((c) => (c.open ? { ...c, open: false } : openComposer(c, unestimatedTail(foodText))));
  };

  const submitText = () => {
    const text = composer.text.trim();
    if (!text || blocked || busy) return;
    lastPhoto.current = false;
    setAdded(null);
    est.fromText(text, consumedTail(composer));
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitText();
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same photo again fires `change` again.
    e.target.value = '';
    if (!file) return;
    lastPhoto.current = true;
    setAdded(null);
    est.fromPhoto(file, composerShown ? composer.text : '');
  };

  const addEstimate = () => {
    if (phase.kind !== 'result' || !phase.drafts.length) return;
    const add = buildFoodAdd(draftsToItems(phase.drafts), phase.photoId, phase.consumed);
    onAdd(add);
    announceAdded(add);
    est.reset();
    setComposer(COMPOSER_CLOSED);
  };

  const addDish = (add: FoodAdd) => {
    onAdd(add);
    announceAdded(add);
  };

  const retry = () => {
    est.reset();
    setComposer((c) => openComposer(c, unestimatedTail(foodText)));
  };

  return (
    <div ref={rootRef} className={s.root} tabIndex={-1}>
      {aiShown && (
        <div className={s.ai}>
          <div className={s.actions}>
            <button
              ref={toggleRef}
              type="button"
              className={cx(s.action, s.count)}
              aria-label="Порахувати калорії"
              aria-expanded={composerShown}
              aria-controls={composerShown ? composerId : undefined}
              aria-describedby={hint ? hintId : undefined}
              // An open composer can still be folded away while estimating is impossible.
              disabled={busy || (blocked && !composerShown)}
              onClick={toggleComposer}
            >
              <span aria-hidden="true">✨</span> Порахувати
            </button>
            <button
              ref={photoRef}
              type="button"
              className={cx(s.action, s.photo)}
              aria-label="Порахувати калорії за фото"
              aria-describedby={hint ? hintId : undefined}
              disabled={blocked || busy}
              onClick={() => fileRef.current?.click()}
            >
              <span aria-hidden="true">📷</span> Фото
            </button>
            {/* Visually hidden, not display:none: iOS opens the picker reliably only for rendered inputs. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={onFile}
            />
          </div>
          {hint && hint !== error && (
            <p id={hintId} className={s.hint}>
              {hint}
            </p>
          )}
          {/* Inside the sheet (the toast sits outside the modal dialog, where VoiceOver may not read it). */}
          {error && (
            <p id={error === hint ? hintId : undefined} className={s.error} role="alert">
              {error}
            </p>
          )}

          {composerShown && (
            <div id={composerId} className={s.composer}>
              <textarea
                ref={composerRef}
                className={s.composerInput}
                rows={2}
                value={composer.text}
                placeholder={PLACEHOLDER}
                aria-label="Що порахувати"
                enterKeyHint="send"
                onChange={(e) => {
                  const text = e.target.value;
                  setComposer((c) => ({ ...c, text }));
                }}
                onKeyDown={onComposerKey}
              />
              <div className={s.composerBar}>
                <span className={s.composerNote}>Можна додати й фото</span>
                <Button
                  size="sm"
                  className={s.composerSubmit}
                  disabled={!composer.text.trim() || blocked}
                  onClick={submitText}
                >
                  Порахувати
                </Button>
              </div>
            </div>
          )}

          {phase.kind === 'loading' && (
            <EstimateLoading photo={phase.photo} preview={phase.preview} onCancel={est.reset} cancelRef={cancelRef} />
          )}

          {phase.kind === 'result' && (
            <EstimateCard
              drafts={phase.drafts}
              comment={phase.comment}
              photo={phase.photo}
              preview={phase.preview}
              remaining={status.remainingToday}
              titleRef={titleRef}
              onEditKcal={est.editKcal}
              onRemove={est.removeItem}
              onAdd={addEstimate}
              onCancel={est.reset}
              onRetry={retry}
            />
          )}
        </div>
      )}

      <FrequentDishes onAdd={addDish} commit={commit} />

      {/* Always mounted, so changes are read out: progress, what was found, what was added. */}
      <div className={cx('visually-hidden', s.live)} role="status">
        {live && <span key={live.key}>{live.text}</span>}
      </div>
    </div>
  );
}

/** Polite status for screen readers; errors go to the inline role=alert instead. */
function liveMessage(phase: EstimatePhase, added: Announcement | null): Announcement | null {
  if (phase.kind === 'loading') return { key: `l${phase.id}`, text: 'Рахую калорії…' };
  if (phase.kind === 'result') return { key: `r${phase.id}`, text: foundMessage(phase.found.count, phase.found.total) };
  return added;
}

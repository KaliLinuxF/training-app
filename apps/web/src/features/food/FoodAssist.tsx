import type { ISODate, Op } from '@legko/shared';
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { commit as commitOps, useSyncState } from '@/store/data';
import { Button, cx } from '@/ui';
import { EstimateCard, EstimateLoading } from './EstimateCard';
import { useFoodEstimate, type EstimateDeps } from './estimate';
import { useFoodStatus } from './foodStatus';
import { FrequentDishes, foodUseOps } from './FrequentDishes';
import { buildFoodAdd, draftsToItems } from './model';
import type { FoodAdd } from './types';
import s from './FoodAssist.module.css';

export interface FoodAssistProps {
  /** Day being edited (sent with the estimate request; used for «Часті страви» `lastUsed`). */
  date: ISODate;
  /** Called when she confirms an estimate or taps a frequent dish. FoodAssist records `food.use` itself. */
  onAdd: (add: FoodAdd) => void;
  /** Test seams; the app uses the real API, store and toast. */
  estimateDeps?: EstimateDeps;
  commit?: (...ops: Op[]) => void;
}

const PLACEHOLDER = 'Напр.: борщ 300 г, 2 скибки хліба, салат';

/**
 * «✨ Порахувати» / «📷 Фото» + «Часті страви» block under the «Що я їла» textarea (SPEC §3.7).
 * The AI part is hidden when the server has no AI; the chips work offline.
 */
export function FoodAssist({ date, onAdd, estimateDeps, commit = commitOps }: FoodAssistProps) {
  const status = useFoodStatus();
  const { online } = useSyncState();
  const est = useFoodEstimate(date, estimateDeps);
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const composerId = useId();
  const hintId = useId();

  // Another day in the sheet: drop whatever was being estimated for the previous one.
  const { reset } = est;
  useEffect(() => () => reset(), [date, reset]);

  const { phase } = est;
  const aiShown = status?.enabled === true;
  const exhausted = aiShown && status.remainingToday <= 0;
  const busy = phase.kind !== 'idle';
  const blocked = !online || exhausted;
  const hint = !online ? 'Потрібен інтернет' : exhausted ? 'Ліміт підрахунків на сьогодні вичерпано' : null;
  const composerShown = composerOpen && phase.kind === 'idle';

  const submitText = () => {
    if (!text.trim() || blocked || busy) return;
    est.fromText(text);
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
    if (file) est.fromPhoto(file, composerOpen ? text : '');
  };

  const addEstimate = () => {
    if (phase.kind !== 'result' || !phase.drafts.length) return;
    const items = draftsToItems(phase.drafts);
    onAdd(buildFoodAdd(items, phase.photoId));
    commit(...foodUseOps(date, items));
    est.reset();
    setText('');
    setComposerOpen(false);
  };

  const retry = () => {
    est.reset();
    setComposerOpen(true);
  };

  return (
    <div className={s.root}>
      {aiShown && (
        <div className={s.ai}>
          <div className={s.actions}>
            <button
              type="button"
              className={cx(s.action, s.count)}
              aria-label="Порахувати калорії"
              aria-expanded={composerShown}
              aria-controls={composerShown ? composerId : undefined}
              aria-describedby={hint ? hintId : undefined}
              // An open composer can still be folded away while estimating is impossible.
              disabled={busy || (blocked && !composerShown)}
              onClick={() => setComposerOpen((v) => !v)}
            >
              <span aria-hidden="true">✨</span> Порахувати
            </button>
            <button
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
          {hint && (
            <p id={hintId} className={s.hint}>
              {hint}
            </p>
          )}

          {composerShown && (
            <div id={composerId} className={s.composer}>
              <textarea
                className={s.composerInput}
                rows={2}
                value={text}
                placeholder={PLACEHOLDER}
                aria-label="Що порахувати"
                enterKeyHint="send"
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onComposerKey}
              />
              <div className={s.composerBar}>
                <span className={s.composerNote}>Можна додати й фото</span>
                <Button size="sm" className={s.composerSubmit} disabled={!text.trim() || blocked} onClick={submitText}>
                  Порахувати
                </Button>
              </div>
            </div>
          )}

          {phase.kind === 'loading' && <EstimateLoading photo={phase.photo} preview={phase.preview} onCancel={est.reset} />}

          {phase.kind === 'result' && (
            <EstimateCard
              drafts={phase.drafts}
              comment={phase.comment}
              preview={phase.preview}
              remaining={status.remainingToday}
              onEditKcal={est.editKcal}
              onRemove={est.removeItem}
              onAdd={addEstimate}
              onCancel={est.reset}
              onRetry={retry}
            />
          )}
        </div>
      )}

      <FrequentDishes date={date} onAdd={onAdd} commit={commit} />
    </div>
  );
}

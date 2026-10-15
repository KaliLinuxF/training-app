import { useId, type ChangeEvent, type KeyboardEvent, type Ref } from 'react';
import { Button, cx } from '@/ui';
import s from './FoodAssist.module.css';

/**
 * What the first AI button does:
 * - `count`: «✨ Порахувати» — estimates the meal text;
 * - `rest`: «✨ Порахувати решту» — estimates the pending tail (what she wrote after the counted text);
 * - `more`: «✨ Додати ще» — opens the composer «Що ще порахувати?».
 */
export type AssistMode = 'count' | 'rest' | 'more';

export interface AssistHint {
  id: string;
  text: string;
}

export interface FoodAssistProps {
  mode: AssistMode;
  /** The pending tail (part of «Порахувати решту»'s accessible name). */
  tail: string;
  /** Why both buttons cannot estimate (offline, no estimates left, 30 positions); shown under them. */
  blocked?: AssistHint;
  /** The positions card's alert says what `blocked` says (a 429 on «Перерахувати») and has its id: no line here. */
  blockedInCard?: boolean;
  /** Why the first one cannot (an empty meal text): a description, not a visible line. */
  countHint?: AssistHint;
  /** Why the photo one cannot (12 photos on the day); shown under them. */
  photoHint?: AssistHint;
  /** A request runs (estimate or recalculation): both wait. */
  busy: boolean;
  /** Why the last estimate failed (inline alert; when it says what `blocked` says, it is that line). */
  error?: string;
  composerOpen: boolean;
  composerText: string;
  firstRef?: Ref<HTMLButtonElement>;
  photoRef?: Ref<HTMLButtonElement>;
  composerRef?: Ref<HTMLTextAreaElement>;
  /** «✨ Порахувати» / «Порахувати решту» (the meal text or its tail) — or, with the text empty, «go type». */
  onCount: () => void;
  /** «✨ Додати ще»: opens or folds the composer. */
  onToggleComposer: () => void;
  onComposerText: (text: string) => void;
  onSubmitComposer: () => void;
  onPhoto: (file: File) => void;
}

const COMPOSER_PLACEHOLDER = 'Напр.: яблуко, кава з молоком';

/**
 * The meal editor's AI row (above «Що я їла», so the iPhone keyboard never covers it): «✨ Порахувати»
 * (or «Порахувати решту» / «Додати ще») and «📷 Фото», their hints and the last failure, and the
 * composer «Що ще порахувати?». Never natively disabled: a locked button keeps her focus.
 */
export function FoodAssist({
  mode,
  tail,
  blocked,
  blockedInCard = false,
  countHint,
  photoHint,
  busy,
  error,
  composerOpen,
  composerText,
  firstRef,
  photoRef,
  composerRef,
  onCount,
  onToggleComposer,
  onComposerText,
  onSubmitComposer,
  onPhoto,
}: FoodAssistProps) {
  const composerId = useId();
  const fileId = useId();
  const firstLocked = busy || blocked !== undefined || (mode !== 'more' && countHint !== undefined);
  // The open composer can still be folded away while estimating is impossible (not while a request runs).
  const toggleLocked = mode === 'more' && (busy || (!composerOpen && blocked !== undefined));
  const photoLocked = busy || blocked !== undefined || photoHint !== undefined;
  const describe = (...hints: (AssistHint | undefined)[]) =>
    hints
      .filter((h): h is AssistHint => h !== undefined)
      .map((h) => h.id)
      .join(' ') || undefined;
  // A 429: the alert says what the hint would — one line, which the buttons are described by.
  const errorIsBlocked = error !== undefined && error === blocked?.text;

  const first = () => {
    if (mode === 'more') {
      if (!toggleLocked) onToggleComposer();
      return;
    }
    // With the text empty it still helps: «Опиши, що їла» (the caller moves her to the text).
    if (!busy && blocked === undefined) onCount();
  };

  const pick = () => {
    if (!photoLocked) document.getElementById(fileId)?.click();
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same photo again fires `change` again.
    e.target.value = '';
    if (file) onPhoto(file);
  };

  const submit = () => {
    if (composerText.trim() && !busy && blocked === undefined) onSubmitComposer();
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const label =
    mode === 'count'
      ? 'Порахувати калорії'
      : mode === 'rest'
        ? `Порахувати решту: ${tail}`
        : 'Додати ще: порахувати калорії';
  const text = mode === 'count' ? 'Порахувати' : mode === 'rest' ? 'Порахувати решту' : 'Додати ще';

  return (
    <div className={s.ai}>
      <div className={s.actions}>
        <button
          ref={firstRef}
          type="button"
          className={cx(s.action, s.count)}
          aria-label={label}
          aria-expanded={mode === 'more' ? composerOpen : undefined}
          aria-controls={mode === 'more' && composerOpen ? composerId : undefined}
          aria-disabled={(mode === 'more' ? toggleLocked : firstLocked) || undefined}
          aria-describedby={describe(blocked, mode === 'more' ? undefined : countHint)}
          onClick={first}
        >
          <span aria-hidden="true">✨</span> {text}
        </button>
        <button
          ref={photoRef}
          type="button"
          className={cx(s.action, s.photo)}
          aria-label="Порахувати калорії за фото"
          aria-disabled={photoLocked || undefined}
          aria-describedby={describe(blocked, photoHint)}
          onClick={pick}
        >
          <span aria-hidden="true">📷</span> Фото
        </button>
        {/* Visually hidden, not display:none: iOS opens the picker reliably only for rendered inputs. */}
        <input
          id={fileId}
          type="file"
          accept="image/*"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>
      {blocked && !errorIsBlocked && !blockedInCard && (
        <p id={blocked.id} className={s.hint}>
          {blocked.text}
        </p>
      )}
      {!blocked && photoHint && (
        <p id={photoHint.id} className={s.hint}>
          {photoHint.text}
        </p>
      )}
      {countHint && (
        <span id={countHint.id} className="visually-hidden">
          {countHint.text}
        </span>
      )}
      {/* Inside the sheet (the toast sits outside the modal dialog, where VoiceOver may not read it). */}
      {error && (
        <p id={errorIsBlocked ? blocked?.id : undefined} className={s.error} role="alert">
          {error}
        </p>
      )}

      {composerOpen && !busy && (
        <div id={composerId} className={s.composer}>
          <textarea
            ref={composerRef}
            className={s.composerInput}
            rows={2}
            value={composerText}
            placeholder={COMPOSER_PLACEHOLDER}
            aria-label="Що ще порахувати?"
            enterKeyHint="send"
            onChange={(e) => onComposerText(e.target.value)}
            onKeyDown={onComposerKey}
          />
          <div className={s.composerBar}>
            <span className={s.composerNote}>Можна додати й фото</span>
            <Button
              size="sm"
              className={s.composerSubmit}
              aria-disabled={!composerText.trim() || busy || blocked !== undefined || undefined}
              onClick={submit}
            >
              Порахувати
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

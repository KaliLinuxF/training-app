import { f0, LIMITS } from '@legko/shared';
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { Button, Card, CardHeader, cx } from '@/ui';
import {
  draftsTotal,
  isNamed,
  MAX_ROWS,
  needsRecalc,
  scaledByWeight,
  type DraftField,
  type DraftItem,
} from './drafts';
import { focusFirst, neighbourControls } from './focus';
import { emptyEstimateComment, pluralUk, remainingHint } from './model';
import s from './EstimateCard.module.css';

export interface EstimateCardProps {
  drafts: readonly DraftItem[];
  comment: string;
  /** The estimate came from a photo (changes the advice when nothing was found). */
  photo?: boolean;
  /** Thumbnail (`data:` URL) when the estimate came from a photo. */
  preview: string | null;
  /** Estimates left today (hint shown when ≤ 10). */
  remaining: number | null;
  /** The «Оцінка калорій» title (focusable with tabIndex −1): focus lands here when the result arrives. */
  titleRef?: Ref<HTMLSpanElement>;
  /** «✨ Перерахувати» is waiting for the model («Рахую…»); «Додати» waits for its numbers. */
  recalculating?: boolean;
  /** Why the last recalculation failed (inline alert; the toast is FoodAssist's). */
  recalcError?: string;
  /**
   * Recalculating is impossible right now (offline, no estimates left today): why, and the id of
   * the line FoodAssist shows it in. When the card's alert says the same (a 429 on «Перерахувати»),
   * the alert takes that id over and FoodAssist hides its line: one line in the sheet.
   */
  blockedHint?: { id: string; text: string };
  onEdit: (itemId: string, field: DraftField, value: string) => void;
  /** «+ позиція». */
  onAddItem: () => void;
  onRemove: (itemId: string) => void;
  onRecalculate: () => void;
  onAdd: () => void;
  onCancel: () => void;
  /** Back to the composer (shown when nothing was recognised). */
  onRetry: () => void;
}

/** Itemised estimate she can correct (name, portion, kcal, rows) before adding it to the day. */
export function EstimateCard({
  drafts,
  comment,
  photo = false,
  preview,
  remaining,
  titleRef,
  recalculating = false,
  recalcError,
  blockedHint,
  onEdit,
  onAddItem,
  onRemove,
  onRecalculate,
  onAdd,
  onCancel,
  onRetry,
}: EstimateCardProps) {
  const titleId = useId();
  const recalcId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  /** «Додати» (or «Спробувати ще»), then «Скасувати»: where focus goes when «Перерахувати» does. */
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const total = draftsTotal(drafts);
  const empty = drafts.length === 0;
  const canAdd = drafts.some(isNamed);
  const dirty = drafts.filter(needsRecalc).length;
  const recalcBlocked = blockedHint !== undefined;
  // «Сьогодні ще…» unless the sheet says it already (FoodAssist's «Ліміт…» line, or the alert).
  const remainingLine = remainingHint(remaining);
  const hint = remainingLine !== recalcError && remainingLine !== blockedHint?.text ? remainingLine : null;
  const thumb = preview ? <img className={s.thumb} src={preview} alt="Фото їжі" /> : null;
  // While a request runs it stays, as «Рахую…», even if she has undone every change meanwhile:
  // it says what «Додати» is waiting for.
  const recalcShown = dirty > 0 || recalculating;

  // «✨ Перерахувати» goes away once nothing waits for it: focus must not fall to <body> with it
  // (a removed row moves focus itself, to its neighbour).
  const wasRecalcShown = useRef(recalcShown);
  const removing = useRef(false);
  useLayoutEffect(() => {
    const was = wasRecalcShown.current;
    wasRecalcShown.current = recalcShown;
    if (!was || recalcShown || removing.current || !focusLost()) return;
    focusFirst([primaryRef.current, cancelRef.current]);
  }, [recalcShown]);

  const addRow = () => {
    flushSync(onAddItem);
    // Straight to the new row's name, still inside the tap (iOS opens the keyboard only then).
    listRef.current?.lastElementChild?.querySelector('input')?.focus();
  };

  const removeRow = (e: MouseEvent<HTMLButtonElement>, itemId: string) => {
    const row = e.currentTarget.closest('li');
    const next = row ? [...neighbourControls(row, 'after'), ...neighbourControls(row, 'before')] : [];
    removing.current = true;
    try {
      flushSync(() => onRemove(itemId));
    } finally {
      removing.current = false;
    }
    if (focusLost()) focusFirst(next);
  };

  // Both stay focusable when they cannot act (aria-disabled): a button natively disabled under her
  // focus — a 429 or going offline while «Рахую…» — would drop it to <body>, out of the sheet.
  const recalculate = () => {
    if (!recalculating && !recalcBlocked) onRecalculate();
  };

  // Adding now would keep the old dish's kcal under her new name (also in «Часті страви») and
  // throw away the answer she is waiting for, already counted against today's estimates.
  const add = () => {
    if (!recalculating) onAdd();
  };

  const addRowButton =
    drafts.length < MAX_ROWS ? (
      <button type="button" className={s.addRow} onClick={addRow}>
        + позиція
      </button>
    ) : null;

  return (
    <Card as="section" gap={14} className={s.card} aria-labelledby={titleId}>
      <CardHeader
        as="h3"
        size="sm"
        titleId={titleId}
        title={
          <span ref={titleRef} tabIndex={-1} className={s.title}>
            Оцінка калорій
          </span>
        }
        subtitle={
          empty ? 'Нічого не знайдено' : `${drafts.length} ${pluralUk(drafts.length, 'позиція', 'позиції', 'позицій')} · можна виправити`
        }
        right={thumb}
      />

      {!empty && (
        <>
          <ul ref={listRef} className={s.items}>
            {drafts.map((d, i) => (
              <EstimateRow key={d.id} item={d} index={i} onEdit={onEdit} onRemove={removeRow} />
            ))}
          </ul>
          {addRowButton}
          <div className={s.total}>
            <span className={s.totalLabel}>Разом</span>
            <span className={s.totalValue} aria-live="polite">
              {f0(total)} <span className={s.unit}>ккал</span>
            </span>
          </div>
        </>
      )}

      {(comment || empty) && <p className={s.comment}>{comment || emptyEstimateComment(photo)}</p>}
      {empty && addRowButton}
      {hint && <p className={s.remaining}>{hint}</p>}
      {recalcError && (
        <p
          id={blockedHint && recalcError === blockedHint.text ? blockedHint.id : undefined}
          className={s.error}
          role="alert"
        >
          {recalcError}
        </p>
      )}

      {recalcShown && (
        <button
          id={recalcId}
          type="button"
          className={cx(s.recalc, recalculating && s.busy)}
          aria-disabled={recalculating || recalcBlocked || undefined}
          aria-describedby={blockedHint?.id}
          onClick={recalculate}
        >
          {recalculating ? (
            'Рахую…'
          ) : (
            <>
              <span aria-hidden="true">✨</span> Перерахувати
            </>
          )}
        </button>
      )}

      <div className={s.buttons}>
        {empty ? (
          <Button ref={primaryRef} className={s.primary} variant="outline" onClick={onRetry}>
            Спробувати ще
          </Button>
        ) : (
          <Button
            ref={primaryRef}
            className={s.primary}
            disabled={!canAdd}
            aria-disabled={recalculating || undefined}
            // «Рахую…»: what it is waiting for.
            aria-describedby={recalculating ? recalcId : undefined}
            onClick={add}
          >
            Додати {f0(total)} ккал
          </Button>
        )}
        <Button ref={cancelRef} variant="ghost" className={s.cancel} onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </Card>
  );
}

/** Focus went down with a control that was just removed (or never was anywhere). */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** «Готово» on the iPhone keyboard just closes it; never submits anything around the card. */
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

interface EstimateRowProps {
  item: DraftItem;
  index: number;
  onEdit: (itemId: string, field: DraftField, value: string) => void;
  onRemove: (e: MouseEvent<HTMLButtonElement>, itemId: string) => void;
}

function EstimateRow({ item, index, onEdit, onRemove }: EstimateRowProps) {
  const noteId = useId();
  const n = index + 1;
  // At most one of them: «змінено» waits for the model, the note says the device rescaled it.
  const changed = needsRecalc(item);
  const scaled = scaledByWeight(item);
  const name = item.name.trim();
  return (
    <li className={s.item}>
      <input
        className={s.name}
        value={item.name}
        placeholder="Назва страви"
        aria-label={`Назва позиції ${n}`}
        maxLength={LIMITS.foodName}
        enterKeyHint="done"
        autoComplete="off"
        onChange={(e) => onEdit(item.id, 'name', e.target.value)}
        onKeyDown={blurOnEnter}
      />
      <button
        type="button"
        className={s.remove}
        aria-label={name ? `Прибрати «${name}»` : `Прибрати позицію ${n}`}
        onClick={(e) => onRemove(e, item.id)}
      >
        <span aria-hidden="true">✕</span>
      </button>
      <input
        className={s.portion}
        value={item.portion}
        placeholder="напр. 150 г"
        aria-label={`Порція позиції ${n}`}
        maxLength={LIMITS.portion}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(e) => onEdit(item.id, 'portion', e.target.value)}
        onKeyDown={blurOnEnter}
      />
      <label className={s.kcal}>
        <input
          className={s.kcalInput}
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={5}
          value={item.kcalText}
          placeholder="0"
          aria-label={`Калорії позиції ${n}`}
          aria-describedby={changed || scaled ? noteId : undefined}
          onChange={(e) => onEdit(item.id, 'kcal', e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={blurOnEnter}
        />
        <span className={s.unit}>ккал</span>
      </label>
      {(changed || scaled) && (
        <p id={noteId} className={s.note}>
          {changed ? <span className={s.tag}>змінено</span> : 'перераховано за вагою'}
        </p>
      )}
    </li>
  );
}

export interface EstimateLoadingProps {
  /** The estimate is for a photo (shows its thumbnail, or a placeholder while it is prepared). */
  photo: boolean;
  preview: string | null;
  onCancel: () => void;
  /** «Скасувати»: focus waits here while the model answers. */
  cancelRef?: Ref<HTMLButtonElement>;
}

/**
 * «Рахую калорії…» placeholder while the photo is prepared and the model answers. Not a live
 * region itself (one inserted with its text already in it is often not read): FoodAssist's
 * persistent status region announces the progress.
 */
export function EstimateLoading({ photo, preview, onCancel, cancelRef }: EstimateLoadingProps) {
  return (
    <div className={s.loading}>
      {preview ? (
        <img className={s.thumb} src={preview} alt="" />
      ) : (
        <span className={photo ? s.thumbSkeleton : s.spark} aria-hidden="true">
          {photo ? null : '✨'}
        </span>
      )}
      <div className={s.loadingBody}>
        <span className={s.loadingTitle}>Рахую калорії…</span>
        <span className={s.bar} aria-hidden="true" />
        <span className={`${s.bar} ${s.barShort}`} aria-hidden="true" />
      </div>
      <Button ref={cancelRef} variant="ghost" className={s.loadingCancel} onClick={onCancel}>
        Скасувати
      </Button>
    </div>
  );
}

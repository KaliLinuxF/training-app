import { f0, type FoodItem } from '@legko/shared';
import { useEffect, useId, useLayoutEffect, useRef, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { useAppData } from '@/store/data';
import { Button, Card, CardHeader, cx } from '@/ui';
import { draftsTotal, isNamed, MAX_ROWS, needsRecalc, type DraftItem } from './drafts';
import { focusFirst, focusIsAround } from './focus';
import { ItemEditor } from './ItemEditor';
import type { EditorAction, ItemEditorState } from './itemEditorModel';
import { emptyEstimateComment, parseKcal, pluralUk, remainingHint } from './model';
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
  /** The running (or failed) recalculation was asked for in the item editor: its «Рахую…» and alert are there. */
  recalcInEditor?: boolean;
  /**
   * Recalculating is impossible right now (offline, no estimates left today): why, and the id of
   * the line FoodAssist shows it in. When the card's alert says the same (a 429 on «Перерахувати»),
   * the alert takes that id over and FoodAssist hides its line: one line in the sheet.
   */
  blockedHint?: { id: string; text: string };
  /** The item editor over the day sheet, when open. */
  editor?: ItemEditorState | null;
  /** «Часті страви» the editor suggests; the app's data by default. */
  foods?: readonly FoodItem[];
  /** A row was tapped: open the editor on it. */
  onOpenItem: (itemId: string) => void;
  /** «+ позиція»: the editor on a new row. */
  onNewItem: () => void;
  onEditorChange: (action: EditorAction) => void;
  /** «Готово» / «Додати позицію». */
  onSaveItem: () => void;
  /** The editor's draft is dropped. */
  onCloseItem: () => void;
  /** «Видалити позицію». */
  onRemove: (itemId: string) => void;
  onRecalculate: () => void;
  onAdd: () => void;
  onCancel: () => void;
  /** Back to the composer (shown when nothing was recognised). */
  onRetry: () => void;
}

/**
 * Itemised estimate (SPEC §3.7 «Result card»): a clean list of the positions; tapping one, or
 * «+ позиція», opens the item editor in a second sheet. Total, «✨ Перерахувати» for the rows the
 * model has to price again, «Додати N ккал» / «Скасувати».
 */
export function EstimateCard({
  drafts,
  comment,
  photo = false,
  preview,
  remaining,
  titleRef,
  recalculating = false,
  recalcError,
  recalcInEditor = false,
  blockedHint,
  editor = null,
  foods,
  onOpenItem,
  onNewItem,
  onEditorChange,
  onSaveItem,
  onCloseItem,
  onRemove,
  onRecalculate,
  onAdd,
  onCancel,
  onRetry,
}: EstimateCardProps) {
  const appFoods = useAppData().foods;
  const titleId = useId();
  const recalcId = useId();
  /** «Додати» (or «Спробувати ще»), then «Скасувати»: where focus goes when «Перерахувати» does. */
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const addRowRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const nameRef = useRef<HTMLInputElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  /** Rows to put focus on once the editor closes (first one still there wins). */
  const focusAfterEditor = useRef<string[]>([]);

  const total = draftsTotal(drafts);
  const empty = drafts.length === 0;
  const canAdd = drafts.some(isNamed);
  const dirty = drafts.filter(needsRecalc).length;
  const recalcBlocked = blockedHint !== undefined;
  const editorOpen = editor !== null;
  // «Сьогодні ще…» unless the sheet says it already (FoodAssist's «Ліміт…» line, or the alert).
  const remainingLine = remainingHint(remaining);
  const hint = remainingLine !== recalcError && remainingLine !== blockedHint?.text ? remainingLine : null;
  const thumb = preview ? <img className={s.thumb} src={preview} alt="Фото їжі" /> : null;
  // While a request runs it stays, as «Рахую…», even if she has undone every change meanwhile:
  // it says what «Додати» is waiting for.
  const recalcShown = dirty > 0 || recalculating;

  // «✨ Перерахувати» goes away once nothing waits for it: focus must not fall to <body> with it.
  const wasRecalcShown = useRef(recalcShown);
  useLayoutEffect(() => {
    const was = wasRecalcShown.current;
    wasRecalcShown.current = recalcShown;
    if (!was || recalcShown || !focusLost()) return;
    focusFirst([primaryRef.current, cancelRef.current]);
  }, [recalcShown]);

  // The editor started closing. Over the day sheet the kit has just given focus back to the row
  // (or, the row deleted, to the day sheet) — a child's effect, so it ran before this one; move it
  // on to the row she saved, the one she added, or the deleted row's neighbour. Not if she is
  // already working somewhere else.
  const wasEditorOpen = useRef(editorOpen);
  useEffect(() => {
    const was = wasEditorOpen.current;
    wasEditorOpen.current = editorOpen;
    if (!was || editorOpen) return;
    const rows = focusAfterEditor.current;
    focusAfterEditor.current = [];
    const card = primaryRef.current?.closest('section');
    const active = document.activeElement;
    const inEditor = active !== null && editorBodyRef.current?.closest('[role="dialog"]')?.contains(active);
    if (card && !inEditor && !focusIsAround(card)) return;
    focusFirst([
      ...rows.map((id) => rowButtons.current.get(id)),
      addRowRef.current,
      primaryRef.current,
      cancelRef.current,
    ]);
  }, [editorOpen]);

  const newRow = () => {
    flushSync(onNewItem);
    // Straight to the name, still inside the tap (iOS opens the keyboard only then).
    nameRef.current?.focus();
  };

  const saveItem = () => {
    if (editor) focusAfterEditor.current = [editor.item.id];
    onSaveItem();
  };

  const closeItem = () => {
    focusAfterEditor.current = editor?.original ? [editor.original.id] : [];
    onCloseItem();
  };

  const removeItem = (itemId: string) => {
    const i = drafts.findIndex((d) => d.id === itemId);
    focusAfterEditor.current = [drafts[i + 1]?.id, drafts[i - 1]?.id].filter((id) => id !== undefined);
    onRemove(itemId);
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
      <button ref={addRowRef} type="button" className={s.addRow} onClick={newRow}>
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
          <ul className={s.items}>
            {drafts.map((d, i) => (
              <EstimateRow
                key={d.id}
                item={d}
                index={i}
                buttonRef={(el) => {
                  if (el) rowButtons.current.set(d.id, el);
                  else rowButtons.current.delete(d.id);
                }}
                onOpen={onOpenItem}
              />
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
          // The editor over the card says it while it is open (one alert, not two).
          role={editorOpen ? undefined : 'alert'}
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

      <ItemEditor
        state={editor}
        foods={foods ?? appFoods}
        recalculating={recalculating}
        recalcAskedHere={recalcInEditor}
        recalcError={recalcInEditor ? recalcError : undefined}
        blockedReason={blockedHint?.text ?? null}
        nameRef={nameRef}
        bodyRef={editorBodyRef}
        onChange={onEditorChange}
        onSave={saveItem}
        onDiscard={closeItem}
        onRemove={removeItem}
        onRecalculate={onRecalculate}
      />
    </Card>
  );
}

/** Focus went down with a control that was just removed (or never was anywhere). */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/**
 * Kcal she typed herself (tagged «вручну»). A «Часті страви» dish's are pinned too, but they are
 * her usual numbers, not a correction: that row reads like any other.
 */
const typedByHand = (item: DraftItem): boolean => item.pinned && !item.fromDish;

/** What a row says to VoiceOver: «Сирники зі сметаною, 3 шт, 420 ккал. Змінити». */
export function rowLabel(item: DraftItem, index: number): string {
  const parts = [
    item.name.trim() || `Позиція ${index + 1}`,
    item.portion.trim(),
    `${f0(parseKcal(item.kcalText))} ккал`,
    needsRecalc(item) ? 'змінено' : '',
    typedByHand(item) ? 'вписано вручну' : '',
  ];
  return `${parts.filter(Boolean).join(', ')}. Змінити`;
}

interface EstimateRowProps {
  item: DraftItem;
  index: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onOpen: (itemId: string) => void;
}

/** One position: name (+ «змінено» / «вручну»), portion under it, kcal and › on the right. */
function EstimateRow({ item, index, buttonRef, onOpen }: EstimateRowProps) {
  const name = item.name.trim();
  const portion = item.portion.trim();
  const changed = needsRecalc(item);
  return (
    <li className={s.item}>
      <button
        ref={buttonRef}
        type="button"
        className={s.row}
        aria-label={rowLabel(item, index)}
        onClick={() => onOpen(item.id)}
      >
        <span className={s.main}>
          <span className={s.nameLine}>
            <span className={cx(s.name, !name && s.nameless)}>{name || `Позиція ${index + 1}`}</span>
            {changed && <span className={s.tag}>змінено</span>}
            {typedByHand(item) && <span className={cx(s.tag, s.tagManual)}>вручну</span>}
          </span>
          {portion && <span className={s.portion}>{portion}</span>}
        </span>
        <span className={s.kcal}>{f0(parseKcal(item.kcalText))} ккал</span>
        <span className={s.chevron} aria-hidden="true">
          ›
        </span>
      </button>
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

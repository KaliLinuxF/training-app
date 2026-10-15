import { f0, type FoodItem } from '@legko/shared';
import { useEffect, useId, useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { macroLine } from '@/lib/nutrition';
import { useAppData } from '@/store/data';
import { Button, Card, CardHeader, cx } from '@/ui';
import { draftMacros, draftsTotals, MAX_ROWS, needsRecalc, type DraftItem } from './drafts';
import { focusFirst, focusIsAround } from './focus';
import { ItemEditor } from './ItemEditor';
import type { EditorAction, ItemEditorState } from './itemEditorModel';
import { macroShort, macroWords, parseKcal, positionsSubtitle, remainingHint } from './model';
import s from './EstimateCard.module.css';

/**
 * Accessible name of «Прибрати ці позиції»: it starts with the visible words, so a voice command «Прибрати ці
 * позиції» finds it (WCAG 2.5.3), and says which positions go.
 */
export const UNDO_LABEL = 'Прибрати ці позиції — останній підрахунок';

export interface EstimateCardProps {
  drafts: readonly DraftItem[];
  /** The model's remark (or the advice when the last estimate found nothing). */
  comment: string;
  /** The last estimate found nothing: the card shows its advice and «+ позиція» without rows. */
  showEmpty?: boolean;
  /** Estimates left today (hint shown when ≤ 10). */
  remaining: number | null;
  /** The «Позиції» title (focusable with tabIndex −1): focus lands here when an estimate arrives. */
  titleRef?: RefObject<HTMLSpanElement | null>;
  /** «✨ Перерахувати» is waiting for the model («Рахую…»). */
  recalculating?: boolean;
  /** Why the last recalculation failed (inline alert). */
  recalcError?: string;
  /** The running (or failed) recalculation was asked for in the item editor: its «Рахую…» and alert are there. */
  recalcInEditor?: boolean;
  /**
   * Recalculating is impossible right now (offline, no estimates left today): why, and the id of
   * the line the AI row shows it in. When the card's alert says the same (a 429 on «Перерахувати»),
   * the alert takes that id over and the AI row hides its line: one line in the sheet.
   */
  blockedHint?: { id: string; text: string };
  /** The item editor over the meal editor, when open. */
  editor?: ItemEditorState | null;
  /** «Часті страви» the editor suggests; the app's data by default. */
  foods?: readonly FoodItem[];
  /** «Прибрати ці позиції» (right after an estimate). */
  onUndo?: () => void;
  /** Where focus goes when the editor closes and the card is gone (its last row deleted). */
  fallbackFocus?: () => HTMLElement | null;
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
}

/**
 * The meal's positions «Позиції» (docs/meals-macros.md §7.4): a clean list (tapping one, or
 * «+ позиція», opens the item editor in a sheet stacked over the meal editor), «Разом» with
 * Б · Ж · В, «✨ Перерахувати» for the rows the model has to price again, «Прибрати ці позиції»
 * right after an estimate, and the model's remark. The item editor stays mounted when the card goes.
 */
export function EstimateCard({
  drafts,
  comment,
  showEmpty = false,
  remaining,
  titleRef,
  recalculating = false,
  recalcError,
  recalcInEditor = false,
  blockedHint,
  editor = null,
  foods,
  onUndo,
  fallbackFocus,
  onOpenItem,
  onNewItem,
  onEditorChange,
  onSaveItem,
  onCloseItem,
  onRemove,
  onRecalculate,
}: EstimateCardProps) {
  const appFoods = useAppData().foods;
  const titleId = useId();
  const ownTitleRef = useRef<HTMLSpanElement>(null);
  const title = titleRef ?? ownTitleRef;
  const addRowRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const nameRef = useRef<HTMLInputElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  /** Rows to put focus on once the editor closes (first one still there wins). */
  const focusAfterEditor = useRef<string[]>([]);

  const empty = drafts.length === 0;
  const shown = !empty || showEmpty;
  const totals = draftsTotals(drafts);
  const totalMacros = macroLine(totals.macros);
  const dirty = drafts.filter(needsRecalc).length;
  const recalcBlocked = blockedHint !== undefined;
  const editorOpen = editor !== null;
  // «Сьогодні ще…» unless the sheet says it already (the AI row's «Ліміт…» line, or the alert).
  const remainingLine = remainingHint(remaining);
  const hint = remainingLine !== recalcError && remainingLine !== blockedHint?.text ? remainingLine : null;
  // While a request runs it stays, as «Рахую…», even if she has undone every change meanwhile.
  const recalcShown = shown && (dirty > 0 || recalculating);

  // «✨ Перерахувати» goes away once nothing waits for it: focus must not fall to <body> with it.
  const wasRecalcShown = useRef(recalcShown);
  useLayoutEffect(() => {
    const was = wasRecalcShown.current;
    wasRecalcShown.current = recalcShown;
    if (!was || recalcShown || !focusLost()) return;
    focusFirst([undoRef.current, addRowRef.current, title.current]);
  }, [recalcShown, title]);

  // The editor started closing. Over the meal editor the kit has just given focus back to the row
  // (or, the row deleted, to the meal editor) — a child's effect, so it ran before this one; move it
  // on to the row she saved, the one she added, or the deleted row's neighbour. Not if she is
  // already working somewhere else.
  const wasEditorOpen = useRef(editorOpen);
  useEffect(() => {
    const was = wasEditorOpen.current;
    wasEditorOpen.current = editorOpen;
    if (!was || editorOpen) return;
    const rows = focusAfterEditor.current;
    focusAfterEditor.current = [];
    const card = title.current?.closest<HTMLElement>('section') ?? null;
    const active = document.activeElement;
    const inEditor = active !== null && editorBodyRef.current?.closest('[role="dialog"]')?.contains(active);
    const around = card ? focusIsAround(card) : focusLost() || active?.getAttribute('role') === 'dialog';
    if (!inEditor && !around) return;
    focusFirst([
      ...rows.map((id) => rowButtons.current.get(id)),
      addRowRef.current,
      title.current,
      fallbackFocus?.(),
    ]);
  }, [editorOpen, fallbackFocus, title]);

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

  // Never natively disabled: a button locked under her focus — a 429 or going offline while
  // «Рахую…» — would drop it to <body>, out of the sheet.
  const recalculate = () => {
    if (!recalculating && !recalcBlocked) onRecalculate();
  };

  const addRowButton =
    drafts.length < MAX_ROWS ? (
      <button ref={addRowRef} type="button" className={s.addRow} onClick={newRow}>
        + позиція
      </button>
    ) : null;

  return (
    <>
      {shown && (
        <Card as="section" gap={14} className={s.card} aria-labelledby={titleId}>
          <CardHeader
            as="h3"
            size="sm"
            titleId={titleId}
            title={
              <span ref={title} tabIndex={-1} className={s.title}>
                Позиції
              </span>
            }
            subtitle={empty ? 'Нічого не знайдено' : positionsSubtitle(drafts.length)}
          />

          {!empty && (
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
          )}
          {addRowButton}
          {!empty && (
            <div className={s.total}>
              <div className={s.totalLine}>
                <span className={s.totalLabel}>Разом</span>
                <span className={s.totalValue} aria-live="polite">
                  {f0(totals.kcal)} <span className={s.unit}>ккал</span>
                </span>
              </div>
              {totalMacros && <span className={s.totalMacros}>{totalMacros}</span>}
            </div>
          )}

          {comment && <p className={s.comment}>{comment}</p>}
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

          {onUndo && !empty && (
            <Button ref={undoRef} variant="ghost" className={s.undo} aria-label={UNDO_LABEL} onClick={onUndo}>
              Прибрати ці позиції
            </Button>
          )}
        </Card>
      )}

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
    </>
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

/** What a row says to VoiceOver: «Тост з тунцем, 2 шт, 310 ккал, білки 24, жири 8, вуглеводи 31 г. Змінити». */
export function rowLabel(item: DraftItem, index: number): string {
  const parts = [
    item.name.trim() || `Позиція ${index + 1}`,
    item.portion.trim(),
    `${f0(parseKcal(item.kcalText))} ккал`,
    macroWords(draftMacros(item)),
    needsRecalc(item) ? 'змінено' : '',
    typedByHand(item) ? 'вписано вручну' : '',
  ];
  return `${parts.filter(Boolean).join(', ')}. Змінити`;
}

/** The row's second line: «2 шт · Б 24 · Ж 8 · В 31» (each part only when there is one). */
export function rowDetail(item: DraftItem): string {
  return [item.portion.trim(), macroShort(draftMacros(item))].filter(Boolean).join(' · ');
}

interface EstimateRowProps {
  item: DraftItem;
  index: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onOpen: (itemId: string) => void;
}

/** One position: name (+ «змінено» / «вручну»), portion and Б · Ж · В under it, kcal and › on the right. */
function EstimateRow({ item, index, buttonRef, onOpen }: EstimateRowProps) {
  const name = item.name.trim();
  const detail = rowDetail(item);
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
          {detail && <span className={s.portion}>{detail}</span>}
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
 * region itself (one inserted with its text already in it is often not read): the editor's
 * persistent status region announces the progress. «Скасувати» drops only the request.
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

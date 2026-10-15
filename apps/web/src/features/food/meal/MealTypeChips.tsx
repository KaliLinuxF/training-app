import { LIMITS, mealTypeKey } from '@legko/shared';
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Chip, ChipGroup } from '@/ui';
import type { AddedType } from './mealModel';
import s from './MealEditorBody.module.css';

export interface MealTypeChipsProps {
  /** Her types (plus the meal's own label when it is not among them). */
  choices: readonly string[];
  selected: string;
  onSelect: (type: string) => void;
  /** «+ Свій» → ✓: adds the name to her list (when there is room) and selects it. */
  onAdd: (name: string) => AddedType | null;
}

/**
 * «Тип прийому їжі»: single-select chips in ONE row that scrolls sideways on touch (it wraps with a
 * mouse), the selected one scrolled into view on open, and «+ Свій» at the end of the line — outside
 * the scrolling chips, so it is on screen at any width — with an inline name field under the row.
 * Escape in the field cancels it without closing the sheet.
 */
export function MealTypeChips({ choices, selected, onSelect, onAdd }: MealTypeChipsProps) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const selectedKey = mealTypeKey(selected);

  // On open: the selected chip in view (a type far down her list, or the meal's own label at the end).
  useLayoutEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && chip) scrollIntoRow(row, chip);
  }, []);

  const open = () => {
    if (adding) {
      setAdding(false);
      setText('');
      return;
    }
    // Rendered and focused inside the tap, so the iPhone keyboard opens with it.
    flushSync(() => setAdding(true));
    inputRef.current?.focus();
  };

  const cancel = () => {
    setAdding(false);
    setText('');
    addRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const added = onAdd(text);
    if (!added) {
      cancel();
      return;
    }
    flushSync(() => {
      setNote(added.note ?? null);
      setAdding(false);
      setText('');
    });
    // Focus follows the chip she now has.
    const chip = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (chip && rowRef.current) {
      scrollIntoRow(rowRef.current, chip);
      chip.focus();
    } else addRef.current?.focus();
  };

  // Escape cancels the field instead of closing the whole sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    cancel();
  };

  return (
    <div className={s.types}>
      <div className={s.typeRow}>
        <div ref={rowRef} className={s.chipsScroll}>
          <ChipGroup aria-label="Тип прийому їжі" className={s.chips}>
            {choices.map((type) => (
              <Chip
                key={type}
                selected={mealTypeKey(type) === selectedKey}
                className={s.chip}
                onClick={() => onSelect(type)}
              >
                {type}
              </Chip>
            ))}
          </ChipGroup>
        </div>
        <button
          ref={addRef}
          type="button"
          className={s.addType}
          aria-label="Додати свій тип прийому їжі"
          aria-expanded={adding}
          onClick={open}
        >
          + Свій
        </button>
      </div>
      {adding && (
        <form className={s.typeForm} onSubmit={submit}>
          <input
            ref={inputRef}
            className={s.typeInput}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Назва"
            aria-label="Новий тип прийому їжі"
            maxLength={LIMITS.mealTypeName}
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" className={s.typeConfirm} aria-label="Додати тип">
            <span aria-hidden="true">✓</span>
          </button>
        </form>
      )}
      {/* Always mounted, so the note is read out when it appears. */}
      <p className={note ? s.note : 'visually-hidden'} role="status">
        {note}
      </p>
    </div>
  );
}

/**
 * Scrolls a sideways-scrolling row (not the sheet) to show the chip `el` whole inside the row's paddings.
 * Moving on, it goes as far as the start of the next chip when the row can scroll that far (where a fling
 * snaps to as well), so the chip at the left edge is never left as a fragment of a word («нок» of «Сніданок»).
 */
export function scrollIntoRow(row: HTMLElement, el: HTMLElement): void {
  const box = row.getBoundingClientRect();
  // jsdom (and a hidden row) has no layout.
  if (box.width === 0) return;
  const style = getComputedStyle(row);
  const left = box.left + (parseFloat(style.paddingLeft) || 0);
  const right = box.right - (parseFloat(style.paddingRight) || 0);
  const r = el.getBoundingClientRect();
  if (r.left < left) {
    row.scrollLeft -= left - r.left;
    return;
  }
  if (r.right <= right) return;
  const need = r.right - right;
  // At most to the end of the row, and never past `el`'s own start (it must stay whole).
  const most = Math.min(row.scrollWidth - row.clientWidth - row.scrollLeft, r.left - left);
  const starts = Array.from(
    row.querySelectorAll<HTMLElement>('[aria-pressed]'),
    (chip) => chip.getBoundingClientRect().left - left,
  ).filter((d) => d >= need && d <= most);
  row.scrollLeft += starts.length ? Math.min(...starts) : need;
}

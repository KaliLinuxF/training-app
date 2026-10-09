import { LIMITS } from '@legko/shared';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { dataActions } from '@/store/data';
import { Chip, ChipGroup } from '@/ui';
import { addCustomType, toggleType, typeChoices } from './model';
import s from './TypePicker.module.css';

export interface TypePickerProps {
  selected: string[];
  customTypes: readonly string[];
  onChange: (types: string[]) => void;
}

/** Workout type chips (multi-select) + «+ Свій тип», which adds a type to her own list. */
export function TypePicker({ selected, customTypes, onChange }: TypePickerProps) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const close = () => {
    setAdding(false);
    setText('');
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const result = addCustomType(text, customTypes, selected);
    if (result) {
      const next = result.customTypes;
      if (next) dataActions.updateSettings((st) => ({ ...st, customTypes: next }));
      onChange(result.types);
    }
    close();
  };

  // Escape cancels the input instead of closing the whole sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    close();
  };

  return (
    <ChipGroup>
      {typeChoices(customTypes, selected).map((type) => (
        <Chip key={type} selected={selected.includes(type)} onClick={() => onChange(toggleType(selected, type))}>
          {type}
        </Chip>
      ))}
      {adding ? (
        <form className={s.form} onSubmit={submit}>
          <input
            className={s.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Назва типу"
            aria-label="Новий тип тренування"
            maxLength={LIMITS.typeName}
            autoComplete="off"
            enterKeyHint="done"
            autoFocus
          />
          <button type="submit" className={s.confirm} aria-label="Додати тип">
            <span aria-hidden="true">✓</span>
          </button>
        </form>
      ) : (
        <button type="button" className={s.add} onClick={() => setAdding(true)}>
          + Свій тип
        </button>
      )}
    </ChipGroup>
  );
}

import { Chip, cx, Icon } from '@/ui';
import { GROUP_OPTIONS, type LibraryGroup } from './libraryModel';
import s from './LibraryControls.module.css';

export interface SearchFieldProps {
  value: string;
  onChange: (text: string) => void;
  /** Default «Пошук вправи». */
  label?: string;
  autoFocus?: boolean;
  className?: string;
}

/** «Пошук вправи»: a 16px search input (no zoom on iPhone) with a leading glyph. */
export function SearchField({ value, onChange, label = 'Пошук вправи', autoFocus, className }: SearchFieldProps) {
  return (
    <div className={cx(s.search, className)}>
      <span className={s.searchIcon} aria-hidden="true">
        <Icon name="search" size={20} />
      </span>
      <input
        type="search"
        className={s.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={label}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={60}
        autoFocus={autoFocus}
      />
    </div>
  );
}

export interface GroupChipsProps {
  value: LibraryGroup;
  onChange: (group: LibraryGroup) => void;
  /** Sheet bodies pad 18px, pages 0: the row scrolls from the container's edge. */
  edge?: 'page' | 'sheet';
  className?: string;
}

/** «Усі · Груди · Спина · … · Кардіо · Мої»: one line of single-choice chips that scrolls sideways. */
export function GroupChips({ value, onChange, edge = 'page', className }: GroupChipsProps) {
  return (
    <div className={cx(s.scroll, edge === 'sheet' && s.sheetEdge, className)}>
      <div role="group" aria-label="Групи вправ" className={s.chips}>
        {GROUP_OPTIONS.map((g) => (
          <Chip key={g.id} selected={g.id === value} className={s.chip} onClick={() => onChange(g.id)}>
            {g.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

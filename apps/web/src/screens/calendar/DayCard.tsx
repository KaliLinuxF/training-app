import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PhotoStrip } from '@/features/food';
import type { SheetMode } from '@/store/ui';
import { Button, ListGroup, ListRow, Pill, TrainingToggle, type IconName, type ListIconTone } from '@/ui';
import type { DayDetail, DayRowKey, DayRowModel } from './model';
import s from './DayCard.module.css';

export interface DayCardProps {
  detail: DayDetail;
  /** A row (or «Редагувати / Заповнити день») opens its sheet for the selected day. */
  onOpen: (mode: SheetMode) => void;
  /** The inline ✓ / ✕ of the Тренування row. */
  onTrained: (trained: boolean) => void;
  /** Bumped by a day-cell tap: the card scrolls itself into view (`0` = never). */
  reveal: number;
}

const ROW_ICON: Readonly<Record<DayRowKey, { icon: IconName; tone: ListIconTone }>> = {
  food: { icon: 'food', tone: 'acc2' },
  training: { icon: 'workout', tone: 'acc' },
  weight: { icon: 'weight', tone: 'neutral' },
  measures: { icon: 'measure', tone: 'neutral' },
  notes: { icon: 'notes', tone: 'neutral' },
};

/**
 * The selected day as a check-list (redesign A §4.6): one row per thing to record, each opening its short sheet;
 * Тренування has the inline ✓ / ✕; «Редагувати день» opens the full «Запис дня». The region is named by the date.
 */
export function DayCard({ detail, onOpen, onTrained, reveal }: DayCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fade = useChangedSince(detail.date);

  // After a cell tap only: on the phone the rows start near the tab bar. `nearest` does nothing when the card is
  // already in view (desktop, short days); the scroll margins keep it clear of the safe area and the tab bar.
  useEffect(() => {
    if (reveal === 0) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [reveal]);

  return (
    <div ref={rootRef} className={s.root}>
      <ListGroup
        title={detail.title}
        titleSize="lg"
        subtitle={detail.weekday}
        headerRight={<Pill tone={detail.statusTone}>{detail.statusLabel}</Pill>}
        footer={
          <Button variant="outline" fullWidth aria-haspopup="dialog" onClick={() => onOpen('day')}>
            {detail.actionLabel}
          </Button>
        }
      >
        {detail.rows.map((row) => (
          // Keyed by the date: a newly selected day's rows mount afresh and fade in.
          <DayRow
            key={`${detail.date}:${row.key}`}
            row={row}
            photos={detail.photos}
            onOpen={onOpen}
            onTrained={onTrained}
            className={fade ? s.fade : undefined}
          />
        ))}
      </ListGroup>
    </div>
  );
}

interface DayRowProps {
  row: DayRowModel;
  photos: readonly string[];
  onOpen: (mode: SheetMode) => void;
  onTrained: (trained: boolean) => void;
  className?: string;
}

function DayRow({ row, photos, onOpen, onTrained, className }: DayRowProps) {
  const { icon, tone } = ROW_ICON[row.key];
  const training = row.key === 'training';
  let value: ReactNode;
  if (row.filled) value = row.value;
  else if (row.action) value = <span className={s.action}>{row.action}</span>;

  return (
    <ListRow
      className={className}
      icon={icon}
      iconTone={tone}
      title={row.title}
      sub={row.text}
      subWrap
      value={value}
      valueTone={row.valueTone}
      aria-label={row.label}
      describeSub={row.describe}
      onClick={() => onOpen(row.mode)}
      // Every row opens its sheet (a dialog); the ✓ / ✕ beside the Тренування row save at once and do not.
      aria-haspopup="dialog"
      chevron={training ? false : undefined}
      trailing={
        training ? (
          <TrainingToggle
            size="sm"
            value={row.trained ?? null}
            onChange={onTrained}
            aria-label="Тренування за день"
          />
        ) : undefined
      }
    >
      {row.key === 'food' && photos.length > 0 ? <PhotoStrip ids={photos} size="sm" /> : undefined}
    </ListRow>
  );
}

/**
 * `false` until `key` changes for the first time, then `true` — so the rows fade in on a date change but not when
 * the screen first opens (same derived-state pattern as the month grid's slide direction).
 */
function useChangedSince(key: string): boolean {
  const [state, setState] = useState({ key, changed: false });
  if (state.key !== key) {
    setState({ key, changed: true });
    return true;
  }
  return state.changed;
}

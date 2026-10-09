import type { ReactNode } from 'react';
import { Button, ListGroup, ListRow, Pill, type Tone } from '@/ui';
import { FULL_DAY_LABEL, type CaptureMenuRow, type CaptureMenuStatus } from './menuModel';
import type { RecordMode } from './model';
import s from './CaptureMenu.module.css';

export interface CaptureMenuProps {
  rows: CaptureMenuRow[];
  /** «13 жовтня · вівторок» when the menu is for another day than today. */
  dateLine: string | null;
  /** Swaps the same sheet to that form (`'day'` = the full «Запис дня»). */
  onPick: (mode: RecordMode) => void;
}

interface StatusView {
  value?: ReactNode;
  valueVariant?: 'strong' | 'soft';
  valueTone?: Tone;
}

function statusView(status: CaptureMenuStatus | null): StatusView {
  if (!status) return {};
  switch (status.kind) {
    case 'value':
      return { value: status.text, valueVariant: 'soft' };
    case 'over':
      return { value: status.text, valueTone: 'acc' };
    case 'done':
      return { value: status.text, valueTone: 'acc2' };
    case 'due':
      return {
        value: (
          <Pill tone="acc" size="sm">
            {status.text}
          </Pill>
        ),
      };
  }
}

/** «Що записати?»: four big rows in the thumb zone, then «Повний запис дня →». */
export function CaptureMenu({ rows, dateLine, onPick }: CaptureMenuProps) {
  return (
    <div className={s.menu}>
      {dateLine && <p className={s.dateLine}>{dateLine}</p>}
      <ListGroup>
        {rows.map((row) => (
          <ListRow
            key={row.mode}
            size="lg"
            icon={row.icon}
            iconTone={row.iconTone}
            title={row.title}
            sub={row.sub}
            {...statusView(row.status)}
            onClick={() => onPick(row.mode)}
          />
        ))}
      </ListGroup>
      <Button variant="ghost" className={s.fullDay} aria-label={FULL_DAY_LABEL} onClick={() => onPick('day')}>
        {FULL_DAY_LABEL} →
      </Button>
    </div>
  );
}

import { useId, useMemo, useRef } from 'react';
import { ui, type ConfirmOptions } from '@/store/ui';
import { Button, cx, Sheet, useRetained } from '@/ui';
import type { MealTarget } from './mealModel';
import { MealEditorBody } from './MealEditorBody';
import { MEAL_SHEET_HEADING, useMealEditor } from './useMealEditor';
import s from './MealSheet.module.css';

/** ✕ / Escape / backdrop / drag-down with unsaved changes. */
export const DISCARD_MEAL_CONFIRM: Readonly<ConfirmOptions> = {
  title: 'Є незбережені зміни',
  body: 'Закрити без збереження?',
  confirmLabel: 'Закрити',
  cancelLabel: 'Залишитись',
  destructive: true,
};

export interface MealSheetProps {
  /** null = closed (keeps itself mounted during the exit animation). */
  target: MealTarget | null;
  onClose: () => void;
}

/**
 * The kit's drag-to-dismiss slides the panel out before asking; when she stays, slide it back
 * (the inline transform is the only thing holding it down).
 */
function restorePanel(anchor: HTMLElement | null): void {
  const panel = anchor?.closest<HTMLElement>('[role="dialog"]');
  if (!panel) return;
  panel.style.transition = '';
  panel.style.transform = '';
}

interface FooterView {
  canSave: boolean;
  line?: string;
  error: boolean;
}

/**
 * The meal editor stacked over the sheet it is rendered in («Їжа», «Запис дня»): Sheet «Прийом їжі»,
 * footer «Зберегти» (with why it is disabled, or why the save was refused), its own discard guard,
 * toasts. The item editor «Позиція» stacks above it in turn.
 */
export function MealSheet({ target, onClose }: MealSheetProps) {
  const editor = useMealEditor(target);
  const open = target !== null;
  const footerRef = useRef<HTMLDivElement>(null);
  const lineId = useId();
  const line = editor.saveError ?? editor.saveHint;
  const error = editor.saveError !== undefined;
  const view = useMemo<FooterView>(
    () => ({ canSave: editor.canSave, line, error }),
    [editor.canSave, line, error],
  );
  // The footer keeps its look while the sheet slides out.
  const footer = useRetained<FooterView>(open ? view : null);

  const close = () => {
    if (!editor.dirty) {
      onClose();
      return;
    }
    void ui.confirm({ ...DISCARD_MEAL_CONFIRM }).then((ok) => {
      if (ok) onClose();
      else restorePanel(footerRef.current);
    });
  };

  const save = () => {
    if (!editor.save()) return;
    onClose();
    ui.flash('Збережено');
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      heading={MEAL_SHEET_HEADING}
      footer={
        <div ref={footerRef} className={s.footer}>
          {footer?.line && (
            <p
              id={lineId}
              className={cx(s.line, footer.error && s.error)}
              role={footer.error ? 'alert' : undefined}
            >
              {footer.line}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            disabled={!footer?.canSave}
            aria-describedby={footer?.line ? lineId : undefined}
            onClick={save}
          >
            Зберегти
          </Button>
        </div>
      }
    >
      <MealEditorBody
        editor={editor}
        stacked
        onDeleted={() => {
          onClose();
          ui.flash('Прийом видалено');
        }}
      />
    </Sheet>
  );
}

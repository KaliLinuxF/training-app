import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useConfirm, useUiStore } from '@/store/ui';
import { Button } from '../controls/Button';
import s from './ConfirmDialog.module.css';

/**
 * Renders `ui.confirm()` requests: a small centred card over a backdrop (alertdialog),
 * kit-styled replacement for `window.confirm`. Mounted once by the shell.
 */
export function ConfirmHost() {
  const req = useConfirm();
  if (!req) return null;
  return createPortal(<ConfirmDialog key={req.key} />, document.body);
}

/** Resolves whatever request is open right now (stable, safe to call from listeners). */
function resolveOpenConfirm(ok: boolean): void {
  useUiStore.getState().confirm?.resolve(ok);
}

function ConfirmDialog() {
  const req = useConfirm();
  const titleId = useId();
  const bodyId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (req?.destructive ? cancelRef : confirmRef).current?.focus();
    return () => previous?.focus?.();
    // Focus once per dialog instance (keyed by request).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape answers «no» — captured on window so an open sheet underneath does not close as well.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      resolveOpenConfirm(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!req) return null;
  const answer = (ok: boolean) => req.resolve(ok);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // Two buttons only: keep focus inside the dialog.
      const order = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
      const i = order.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
    }
  };

  return (
    <div className={s.backdrop} onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div
        className={s.card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={req.body ? bodyId : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={s.title}>
          {req.title}
        </h2>
        {req.body && (
          <p id={bodyId} className={s.body}>
            {req.body}
          </p>
        )}
        <div className={s.actions}>
          <Button ref={cancelRef} variant="outline" fullWidth onClick={() => answer(false)}>
            {req.cancelLabel ?? 'Скасувати'}
          </Button>
          <Button ref={confirmRef} variant="solid" fullWidth onClick={() => answer(true)}>
            {req.confirmLabel ?? 'Так'}
          </Button>
        </div>
      </div>
    </div>
  );
}

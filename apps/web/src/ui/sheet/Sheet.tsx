import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsDesktop } from '@/lib/platform';
import { StepNav } from '../controls/StepNav';
import { cx } from '../internal/cx';
import { lockScroll } from '../internal/scrollLock';
import { trapTabKey } from './focus';
import { useDragDismiss } from './useDragDismiss';
import s from './Sheet.module.css';

/** Duration of the exit animation; the sheet unmounts after it. */
export const SHEET_EXIT_MS = 240;

export interface SheetDateNav {
  /** Display date «10 жовтня 2026». */
  date: string;
  /** Line under it: «субота · сьогодні». */
  weekday: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;
  /** `false` disables «›» (no future days). */
  canNext?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}

export interface SheetProps {
  open: boolean;
  /** Escape, backdrop click, «✕», drag-down. */
  onClose: () => void;
  /** Small muted heading «Запис дня»; also the dialog's accessible name. */
  heading: string;
  /** Optional «‹ date ›» navigator under the heading. */
  dateNav?: SheetDateNav;
  /** Sticky footer content (usually a full-width «Зберегти» button). */
  footer?: ReactNode;
  children?: ReactNode;
  /** Called after the exit animation, when the sheet has unmounted. */
  onExited?: () => void;
}

/**
 * Bottom sheet on mobile, centred modal on desktop. Portalled into <body>, keeps itself mounted
 * during the exit animation (pair with `useRetained()` so the content stays rendered too).
 */
export function Sheet(props: SheetProps) {
  const { open } = props;
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  const exited = useEffectEvent(() => props.onExited?.());
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => {
      setPresent(false);
      exited();
    }, SHEET_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, present]);

  if (!present) return null;
  return createPortal(<SheetFrame {...props} closing={!open} />, document.body);
}

function SheetFrame({
  heading,
  dateNav,
  footer,
  children,
  onClose,
  closing,
}: SheetProps & { closing: boolean }) {
  const isDesktop = useIsDesktop();
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  const headingId = useId();
  const dateId = useId();
  const requestClose = useEffectEvent(() => onClose());

  // Lock page scroll and move focus into the dialog for its lifetime; restore both afterwards.
  useEffect(() => {
    const release = lockScroll();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      release();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (closing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closing]);

  const drag = useDragDismiss(panelRef, onClose, !closing && !isDesktop);

  // Close only when the press both started and ended on the backdrop (not after a text selection drag).
  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    const fromBackdrop = pressedBackdrop.current && e.target === e.currentTarget;
    pressedBackdrop.current = false;
    if (fromBackdrop && !closing) onClose();
  };

  return (
    <div
      className={cx(s.backdrop, isDesktop ? s.desktop : s.mobile, closing && s.closing)}
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={dateNav ? dateId : undefined}
        tabIndex={-1}
        onKeyDown={trapTabKey}
      >
        <div className={cx(s.header, !dateNav && s.headerPlain)} {...drag}>
          <div className={s.handle} aria-hidden="true" />
          <div className={s.titleRow}>
            <h2 id={headingId} className={s.heading}>
              {heading}
            </h2>
            <button type="button" className={s.close} onClick={onClose} aria-label="Закрити">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {dateNav && (
            <StepNav
              className={s.dateNav}
              surface="card"
              onPrev={dateNav.onPrev}
              onNext={dateNav.onNext}
              canPrev={dateNav.canPrev}
              canNext={dateNav.canNext}
              prevLabel={dateNav.prevLabel ?? 'Попередній день'}
              nextLabel={dateNav.nextLabel ?? 'Наступний день'}
            >
              <div id={dateId} className={s.dateBlock} aria-live="polite">
                <span className={s.date}>{dateNav.date}</span>
                <span className={s.weekday}>{dateNav.weekday}</span>
              </div>
            </StepNav>
          )}
        </div>
        <div className={s.body}>{children}</div>
        {footer != null && <div className={s.footer}>{footer}</div>}
      </div>
    </div>
  );
}

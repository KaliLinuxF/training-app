import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsDesktop } from '@/lib/platform';
import { StepNav } from '../controls/StepNav';
import { cx } from '../internal/cx';
import { lockScroll } from '../internal/scrollLock';
import { focusedElement, holdsFocus, isFocusTarget, trapTabKey } from './focus';
import {
  enterSheetStack,
  isSheetCovered,
  isSheetLive,
  panelBelow,
  setSheetClosing,
  sheetDepth,
  sheetZIndex,
  subscribeSheetStack,
} from './stack';
import { useDragDismiss } from './useDragDismiss';
import s from './Sheet.module.css';

/** Duration of the exit animation; the sheet unmounts after it. */
export const SHEET_EXIT_MS = 240;

/** `compact`: a small window (one food position) — a 440px modal on desktop, a little shorter on phones. */
export type SheetSize = 'default' | 'compact';

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
  /** `'compact'`: a small window such as one food position (default `'default'`). */
  size?: SheetSize;
}

/** Ids of the sheets the current one is rendered inside (outermost first). */
const SheetAncestors = createContext<readonly string[]>([]);

/** To the opener or, when it is gone (e.g. its row was deleted), to the sheet below `id`. */
function giveFocusBack(returnTo: RefObject<HTMLElement | null>, id: string): void {
  const opener = returnTo.current;
  returnTo.current = null;
  const target = isFocusTarget(opener) ? opener : panelBelow(id);
  target?.focus({ preventScroll: true });
}

/**
 * Bottom sheet on mobile, centred modal on desktop. Portalled into <body>, keeps itself mounted
 * during the exit animation (pair with `useRetained()` so the content stays rendered too).
 * Opened while another sheet is open (e.g. rendered inside its content) it stacks above it — see ./stack.ts.
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
  size = 'default',
}: SheetProps & { closing: boolean }) {
  const isDesktop = useIsDesktop();
  const id = useId();
  const ancestors = use(SheetAncestors);
  const lineage = useMemo(() => [...ancestors, id], [ancestors, id]);
  const depth = useSyncExternalStore(subscribeSheetStack, () => sheetDepth(id));
  const covered = useSyncExternalStore(subscribeSheetStack, () => isSheetCovered(id));
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The opener focus goes back to (noted before the sheet below goes inert, which would blur it). */
  const returnTo = useRef<HTMLElement | null>(null);
  /** Focus already went back when the exit started (the sheet below is live again). */
  const handedBack = useRef(false);
  const pressedBackdrop = useRef(false);
  const headingId = useId();
  const dateId = useId();
  const requestClose = useEffectEvent(() => onClose());

  // Note the opener before anything in this commit moves focus: insertion effects run before the
  // content's `autoFocus` and before the sheet below goes inert (which would blur it).
  useInsertionEffect(() => {
    returnTo.current = focusedElement();
  }, []);
  // Reopened while animating out, after focus went back: the new opener is in the sheet below.
  useInsertionEffect(() => {
    if (!closing && handedBack.current) returnTo.current = focusedElement();
  }, [closing]);

  // Join the stack before paint.
  useLayoutEffect(
    () => enterSheetStack(id, ancestors, backdropRef.current, panelRef.current),
    [id, ancestors],
  );

  // Lock page scroll (one shared, ref-counted lock) and move focus into the dialog for its lifetime;
  // restore both afterwards.
  useEffect(() => {
    const panel = panelRef.current;
    const release = lockScroll();
    // Under a sheet that mounted in the same commit (rendered inside this one), that sheet keeps focus.
    if (!isSheetCovered(id)) {
      const active = focusedElement();
      // A sheet this one replaced in the same commit gives focus back to its opener only now: take that.
      if (!isFocusTarget(returnTo.current) && !panel?.contains(active)) returnTo.current = active;
      // Content that took focus itself (`autoFocus`, or focused inside the tap so the iPhone keyboard opens) keeps it.
      if (!panel?.contains(active)) panel?.focus({ preventScroll: true });
    }
    return () => {
      release();
      // Unless it went back when the exit started, or something else has taken it since (a dialog).
      if (!handedBack.current && holdsFocus(panel)) giveFocusBack(returnTo, id);
    };
  }, [id]);

  // The sheet below is live (not inert) again as soon as the exit starts — before the callers' own
  // effects may move focus there — and covered again when this one is reopened during the exit.
  // Taps still land on this sheet's backdrop until it unmounts (see `onBackdropMouseDown`).
  useLayoutEffect(() => setSheetClosing(id, closing), [id, closing]);

  // Over another sheet, focus goes back as soon as the exit starts, unless the caller has put it somewhere.
  useEffect(() => {
    const panel = panelRef.current;
    if (closing) {
      if (sheetDepth(id) > 0 && holdsFocus(panel)) {
        handedBack.current = true;
        giveFocusBack(returnTo, id);
      }
      return;
    }
    // Reopened while animating out, after focus went back: take it again (the opener is noted above).
    const reenter = handedBack.current;
    handedBack.current = false;
    if (reenter && !panel?.contains(document.activeElement)) panel?.focus({ preventScroll: true });
  }, [id, closing]);

  useEffect(() => {
    if (closing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Only the top sheet answers. ui.confirm() and the photo viewer catch Escape before it gets here.
      if (e.key !== 'Escape' || e.isComposing || !isSheetLive(id)) return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closing, id]);

  const drag = useDragDismiss(panelRef, onClose, !closing && !isDesktop && !covered);

  // Close only when the press both started and ended on the backdrop (not after a text selection drag).
  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pressedBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    const fromBackdrop = pressedBackdrop.current && e.target === e.currentTarget;
    pressedBackdrop.current = false;
    if (fromBackdrop && !closing && isSheetLive(id)) onClose();
  };
  // While closing, the backdrop is a shield that swallows presses until the sheet unmounts (`.closing` in the CSS),
  // so the second tap of a double tap cannot reach the sheet below or the page. Swallowed whole: a mouse press on it
  // must not blur what focus went back to either (the opener in the sheet below).
  const onBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (closing && e.target === e.currentTarget) e.preventDefault();
  };

  return (
    <SheetAncestors value={lineage}>
      <div
        ref={backdropRef}
        className={cx(
          s.backdrop,
          isDesktop ? s.desktop : s.mobile,
          depth > 0 && s.stacked,
          size === 'compact' && s.compact,
          closing && s.closing,
        )}
        style={{ zIndex: sheetZIndex(depth) }}
        onPointerDown={onBackdropPointerDown}
        onMouseDown={onBackdropMouseDown}
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
    </SheetAncestors>
  );
}

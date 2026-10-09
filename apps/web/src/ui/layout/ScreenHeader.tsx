import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Icon } from '../icons/Icon';
import { useBackTo } from '../internal/backNav';
import { cx } from '../internal/cx';
import s from './ScreenHeader.module.css';

export interface ScreenHeaderProps {
  /** Small muted line above the title («Історія по днях», «Субота, 10 жовтня»). */
  subtitle?: ReactNode;
  /** Display title («Календар», «Доброго ранку»), rendered as the page's <h1>. */
  title: ReactNode;
  /** Optional element on the right, bottom-aligned (e.g. <Avatar />). */
  right?: ReactNode;
  /**
   * «‹ Налаштування» link above the title of a sub-page (name `Назад: ${label}`). It pops the history entry when
   * the page was opened from `href` (see `useBackTo`), otherwise replace-navigates to `href`.
   */
  back?: { href: string; label: string };
  /** Focus the <h1> on mount (tabIndex −1, no scroll) — for sub-pages opened from a list. */
  focusTitle?: boolean;
  className?: string;
}

function BackLink({ href, label }: { href: string; label: string }) {
  const backTo = useBackTo(href);
  return (
    <Link href={href} className={s.back} aria-label={`Назад: ${label}`} onClick={backTo}>
      <Icon name="chevronLeft" size={20} />
      {label}
    </Link>
  );
}

/** Screen title block; always spans the full width of a <ContentGrid>. */
export function ScreenHeader({ subtitle, title, right, back, focusTitle, className }: ScreenHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);

  const main = (
    <>
      <div className={s.text}>
        {subtitle != null && <p className={s.subtitle}>{subtitle}</p>}
        <h1 ref={titleRef} className={s.title} tabIndex={focusTitle ? -1 : undefined}>
          {title}
        </h1>
      </div>
      {right}
    </>
  );
  return (
    <header className={cx(s.header, back && s.withBack, className)}>
      {back ? (
        <>
          <BackLink href={back.href} label={back.label} />
          <div className={s.row}>{main}</div>
        </>
      ) : (
        main
      )}
    </header>
  );
}

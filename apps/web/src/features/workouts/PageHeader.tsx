import type { MouseEvent, ReactNode } from 'react';
import { cx, Icon } from '@/ui';
import s from './PageHeader.module.css';

export interface PageHeaderProps {
  /** «‹ Мої тренування»: a link to `href` whose click runs `onBack` (which may ask first). */
  back: { href: string; label: string; onBack: () => void; ariaLabel?: string };
  title: ReactNode;
  /** Muted line under the title. */
  subtitle?: ReactNode;
  /** Right of the back link (the session's timer and «Завершити»). */
  right?: ReactNode;
  className?: string;
}

/**
 * The header of the full-screen workouts pages (builder, session, edit): the kit ScreenHeader's look, but the back link
 * is ours, because only it may ask «Вийти без збереження?» (§3.6) or collapse a live session.
 */
export function PageHeader({ back, title, subtitle, right, className }: PageHeaderProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    back.onBack();
  };
  return (
    <header className={cx(s.header, className)}>
      <div className={s.top}>
        <a
          href={back.href}
          className={s.back}
          aria-label={back.ariaLabel ?? `Назад: ${back.label}`}
          onClick={onClick}
        >
          <Icon name="chevronLeft" size={20} />
          {back.label}
        </a>
        {right != null && <div className={s.right}>{right}</div>}
      </div>
      <h1 className={s.title}>{title}</h1>
      {subtitle != null && <p className={s.subtitle}>{subtitle}</p>}
    </header>
  );
}

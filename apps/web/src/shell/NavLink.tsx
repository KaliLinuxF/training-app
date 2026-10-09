import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'wouter';
import { useBackTo } from '@/ui';
import type { NavItem } from './nav';

interface NavLinkProps {
  href: NavItem['href'];
  /** `href` is the current section, sub-pages included (`isNavActive`). */
  active: boolean;
  /** The location is the section root itself, not one of its sub-pages (`isNavRoot`). */
  atRoot: boolean;
  className: string;
  children: ReactNode;
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Section link, like a native tab: another section → normal navigation; the current section at its root →
 * scroll back to the top; the current section on a sub-page (`/settings/goals`) → back to the root
 * (`useBackTo`: pops the entry when it was opened from the root, else replace-navigates).
 * `aria-current` is `page` at the root and `true` on a sub-page.
 */
export function NavLink({ href, active, atRoot, className, children }: NavLinkProps) {
  const backTo = useBackTo(href);
  // Wouter's Link skips modified / non-primary clicks before calling this, so «open in a new tab» still works.
  const onClick = (e: MouseEvent) => {
    if (!active) return;
    if (!atRoot) {
      backTo(e);
      return;
    }
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  return (
    <Link
      href={href}
      className={className}
      aria-current={active ? (atRoot ? 'page' : 'true') : undefined}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

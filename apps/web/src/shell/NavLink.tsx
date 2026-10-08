import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'wouter';
import type { NavItem } from './nav';

interface NavLinkProps {
  href: NavItem['href'];
  active: boolean;
  className: string;
  children: ReactNode;
}

/** Section link; tapping the current section scrolls back to the top instead of re-navigating. */
export function NavLink({ href, active, className, children }: NavLinkProps) {
  const onClick = (e: MouseEvent) => {
    if (!active) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <Link href={href} className={className} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {children}
    </Link>
  );
}

import { cx } from '@/ui';
import { isNavActive, isNavRoot, type NavItem } from './nav';
import { NavLink } from './NavLink';
import s from './Sidebar.module.css';

interface SidebarProps {
  location: string;
  /** The section links, in order (`navItems(isAdmin, 'sidebar')`). */
  items: readonly NavItem[];
  /** «+ Записати день»: open the «Що записати?» menu for today. Absent = no button (the coach's read-only pages). */
  onRecord?: () => void;
  /** The «Що записати?» menu is open (announced on the button as `aria-expanded`). */
  recordOpen?: boolean;
}

/** Desktop left sidebar: logo, section links, «+ Записати день». */
export function Sidebar({ location, items, onRecord, recordOpen = false }: SidebarProps) {
  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <span className={s.mark} aria-hidden="true">
          Л
        </span>
        <span className={s.name}>Легко</span>
      </div>
      <nav className={s.nav} aria-label="Основна навігація">
        {items.map((item) => {
          const active = isNavActive(item.href, location);
          return (
            <NavLink
              key={item.href}
              href={item.href}
              active={active}
              atRoot={isNavRoot(item.href, location)}
              className={cx(s.link, active && s.active)}
            >
              <span className={s.dot} aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      {onRecord && (
        <button
          type="button"
          className={s.record}
          onClick={onRecord}
          aria-haspopup="dialog"
          aria-expanded={recordOpen}
        >
          + Записати день
        </button>
      )}
    </aside>
  );
}

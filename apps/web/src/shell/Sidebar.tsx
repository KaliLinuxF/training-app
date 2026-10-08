import { cx } from '@/ui';
import { NAV_ITEMS, isNavActive } from './nav';
import { NavLink } from './NavLink';
import s from './Sidebar.module.css';

interface SidebarProps {
  location: string;
  /** «+ Записати день»: open today's day sheet. */
  onRecord: () => void;
}

/** Desktop left sidebar: logo, section links, «+ Записати день». */
export function Sidebar({ location, onRecord }: SidebarProps) {
  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <span className={s.mark} aria-hidden="true">
          Л
        </span>
        <span className={s.name}>Легко</span>
      </div>
      <nav className={s.nav} aria-label="Основна навігація">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(item.href, location);
          return (
            <NavLink
              key={item.href}
              href={item.href}
              active={active}
              className={cx(s.link, active && s.active)}
            >
              <span className={s.dot} aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <button type="button" className={s.record} onClick={onRecord}>
        + Записати день
      </button>
    </aside>
  );
}

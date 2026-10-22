import { cx, Icon } from '@/ui';
import { NAV_SPLIT, isNavActive, isNavRoot, type NavItem } from './nav';
import { NavLink } from './NavLink';
import s from './TabBar.module.css';

interface TabBarProps {
  location: string;
  /** The four tabs, in order (`navItems(isAdmin, 'tabbar')`); «+» sits after the first `NAV_SPLIT`. */
  items: readonly NavItem[];
  /**
   * «+»: open the «Що записати?» menu for today. Absent = no «+» (the coach's read-only pages); its 64px slot stays
   * empty so the tabs keep their places.
   */
  onRecord?: () => void;
  /** The «Що записати?» menu is open (announced on «+» as `aria-expanded`). */
  recordOpen?: boolean;
}

/**
 * Mobile floating glass tab bar: Головна · Календар · + · Прогрес · Налаштування (an admin sees «Клієнти» in place of
 * «Прогрес»). Three-part grid (two flexible groups around a fixed 64px centre), so «+» stays centred and the long
 * «Налаштування» label fits at 11px down to 360px.
 */
export function TabBar({ location, items, onRecord, recordOpen = false }: TabBarProps) {
  const tab = (item: NavItem) => {
    const active = isNavActive(item.href, location);
    return (
      <NavLink
        key={item.href}
        href={item.href}
        active={active}
        atRoot={isNavRoot(item.href, location)}
        className={cx(s.item, active && s.active)}
      >
        <span className={s.icon} aria-hidden="true">
          <Icon name={item.icon} size={24} />
        </span>
        <span className={s.label}>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav className={s.bar} aria-label="Основна навігація">
      <div className={s.inner}>
        <div className={s.group}>{items.slice(0, NAV_SPLIT).map(tab)}</div>
        {onRecord ? (
          <button
            type="button"
            className={cx(s.item, s.record)}
            onClick={onRecord}
            aria-label="Записати день"
            aria-haspopup="dialog"
            aria-expanded={recordOpen}
          >
            <span className={s.plus} aria-hidden="true">
              +
            </span>
          </button>
        ) : (
          <span className={s.record} aria-hidden="true" />
        )}
        <div className={s.group}>{items.slice(NAV_SPLIT).map(tab)}</div>
      </div>
    </nav>
  );
}

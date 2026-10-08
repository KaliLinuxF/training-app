import { Fragment } from 'react';
import { cx } from '@/ui';
import { NAV_ITEMS, isNavActive } from './nav';
import { NavLink } from './NavLink';
import s from './TabBar.module.css';

interface TabBarProps {
  location: string;
  /** «+»: open today's day sheet. */
  onRecord: () => void;
}

/** Mobile floating glass tab bar: Головна · Календар · + · Прогрес · Нагадування. */
export function TabBar({ location, onRecord }: TabBarProps) {
  return (
    <nav className={s.bar} aria-label="Основна навігація">
      <div className={s.inner}>
        {NAV_ITEMS.map((item, index) => {
          const active = isNavActive(item.href, location);
          return (
            <Fragment key={item.href}>
              {index === 2 && (
                <button type="button" className={s.item} onClick={onRecord} aria-label="Записати день">
                  <span className={s.plus} aria-hidden="true">
                    +
                  </span>
                </button>
              )}
              <NavLink href={item.href} active={active} className={cx(s.item, active && s.active)}>
                <span className={s.indicator} aria-hidden="true" />
                <span className={s.label}>{item.label}</span>
              </NavLink>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

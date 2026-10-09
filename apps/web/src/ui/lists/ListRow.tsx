import { useId, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ProgressBar } from '../feedback/ProgressBar';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { backState } from '../internal/backNav';
import { cx } from '../internal/cx';
import { toneClass, type Tone } from '../tone';
import s from './ListRow.module.css';

/** Tint of the icon square: `acc` → `--accT` / `--accD`, `acc2` → `--acc2T` / `--acc2D`, `neutral` → `--line2` / `--ink2`. */
export type ListIconTone = 'acc' | 'acc2' | 'neutral';

export interface ListRowBaseProps {
  title: ReactNode;
  /** `'accent'` → `--accD` («Вийти»). Default `'ink'`. */
  titleTone?: 'ink' | 'accent';
  /** Second line: 14/500 `--ink2`, clamped to 2 lines. */
  sub?: ReactNode;
  /** Colour of the sub (default `--ink2`). */
  subTone?: Tone;
  /** No clamp, `white-space: pre-line`, long words break (calendar food text, notes). */
  subWrap?: boolean;
  icon?: IconName;
  /** Default `'neutral'`. */
  iconTone?: ListIconTone;
  /** Right-hand status in the title line: text or a `<Pill>`. */
  value?: ReactNode;
  /** `strong` 15/700 `--ink` (default) · `soft` 15/500 `--ink2`. */
  valueVariant?: 'strong' | 'soft';
  valueTone?: Tone;
  /** Decorative 6px bar under the title (the number is in `value`). */
  meter?: { value: number; tone: 'acc' | 'acc2' };
  /** «›» at the end. Default: shown for links and buttons, hidden for a static row. */
  chevron?: boolean;
  /** A control next to the row's action (sibling, never inside it): `TrainingToggle size="sm"`, `Switch`. */
  trailing?: ReactNode;
  /** Block under the row, outside the action (e.g. a `PhotoStrip`). */
  children?: ReactNode;
  /** `md` 60px (default) · `lg` 72px («Що записати?» menu). */
  size?: 'md' | 'lg';
  /** Replaces the action's name (default: the visible title, sub and value). */
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** Adds the sub's text to the action's description (keeps it audible next to a short `aria-label`). */
  describeSub?: boolean;
  className?: string;
}

export type ListRowProps = ListRowBaseProps &
  (
    | { href: string; replace?: boolean; current?: boolean; onClick?: never; disabled?: never }
    | {
        onClick: () => void;
        disabled?: boolean;
        'aria-haspopup'?: 'dialog';
        href?: never;
        current?: never;
        replace?: never;
      }
    | { href?: never; onClick?: never; disabled?: never; current?: never; replace?: never }
  );

/**
 * One row of a `ListGroup`: a link (`href`, stamps `history.state.legkoFrom` for `useBackTo`), a button (`onClick`)
 * or static content, followed by an optional `trailing` control and a `children` block.
 */
export function ListRow(props: ListRowProps) {
  const [location] = useLocation();
  const subId = useId();
  const {
    title,
    titleTone = 'ink',
    sub,
    subTone,
    subWrap,
    icon,
    iconTone = 'neutral',
    value,
    valueVariant = 'strong',
    valueTone,
    meter,
    chevron,
    trailing,
    children,
    size = 'md',
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    describeSub,
    className,
  } = props;

  const hasSub = sub != null && sub !== false;
  const hasValue = value != null && value !== false;
  const interactive = props.href !== undefined || props.onClick !== undefined;
  const showChevron = chevron ?? interactive;
  const describedBy =
    [ariaDescribedBy, describeSub && hasSub ? subId : undefined].filter(Boolean).join(' ') || undefined;
  // A generic <div> cannot carry a name (ARIA prohibits aria-label on it), so a static row reads its label from
  // visually hidden text and hides the visible copy instead.
  const hideText = !interactive && ariaLabel !== undefined ? true : undefined;

  const content = (
    <>
      {icon && (
        <span className={cx(s.icon, s[iconTone])} aria-hidden="true">
          <Icon name={icon} size={size === 'lg' ? 24 : 22} />
        </span>
      )}
      <span className={cx(s.title, titleTone === 'accent' && s.accent)} aria-hidden={hideText}>
        {title}
      </span>
      {/* Spaces between the parts keep the computed name «Їжа Опис або фото 1 240 ккал» in every engine;
          whitespace between grid items is not rendered. */}
      {hasSub && ' '}
      {hasSub && (
        <span id={subId} className={cx(s.sub, subWrap && s.wrap)} aria-hidden={hideText}>
          {subTone ? <span className={toneClass(subTone)}>{sub}</span> : sub}
        </span>
      )}
      {meter && <ProgressBar value={meter.value} tone={meter.tone} size="sm" className={s.meter} />}
      {hasValue && ' '}
      {hasValue && (
        <span className={cx(s.value, s[valueVariant])} aria-hidden={hideText}>
          {valueTone ? <span className={toneClass(valueTone)}>{value}</span> : value}
        </span>
      )}
      {showChevron && (
        <span className={s.chevron} aria-hidden="true">
          <Icon name="chevronRight" size={16} />
        </span>
      )}
    </>
  );

  const actionClass = cx(
    s.action,
    interactive && s.interactive,
    hasSub && s.hasSub,
    hasSub && subWrap && s.top,
    meter && s.hasMeter,
  );

  let action: ReactNode;
  if (props.href !== undefined) {
    action = (
      <Link
        href={props.href}
        replace={props.replace}
        state={backState(location)}
        aria-current={props.current ? 'page' : undefined}
        className={actionClass}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
      >
        {content}
      </Link>
    );
  } else if (props.onClick !== undefined) {
    action = (
      <button
        type="button"
        className={actionClass}
        onClick={props.onClick}
        disabled={props.disabled}
        aria-haspopup={props['aria-haspopup']}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
      >
        {content}
      </button>
    );
  } else {
    action = (
      <div className={actionClass} aria-describedby={describedBy}>
        {hideText && <span className="visually-hidden">{ariaLabel}</span>}
        {content}
      </div>
    );
  }

  return (
    <li
      className={cx(
        s.item,
        s[size],
        icon && s.withIcon,
        trailing != null && trailing !== false && s.withTrailing,
        className,
      )}
    >
      {action}
      {trailing != null && trailing !== false && <div className={s.trailing}>{trailing}</div>}
      {children != null && children !== false && <div className={s.extra}>{children}</div>}
    </li>
  );
}

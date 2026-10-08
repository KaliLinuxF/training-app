import { cx } from '../internal/cx';
import s from './Avatar.module.css';

export interface AvatarProps {
  /** Letter shown in the circle. */
  letter?: string;
  /** Accessible name; without it the avatar is decorative. */
  label?: string;
  className?: string;
}

/** 44px lavender circle with a letter (Home header). */
export function Avatar({ letter = 'Л', label, className }: AvatarProps) {
  return (
    <div
      className={cx(s.avatar, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {letter}
    </div>
  );
}

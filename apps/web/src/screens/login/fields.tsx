import { PASSWORD_LIMITS } from '@legko/shared';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import s from './LoginScreen.module.css';

/** Label above, the control, an optional muted hint below (its id goes into the control's `aria-describedby`). */
export function Field({
  id,
  label,
  hint,
  hintId,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  hintId?: string;
  children: ReactNode;
}) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className={s.fieldHint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Joins ids for `aria-describedby` (undefined when none). */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return list.length > 0 ? list.join(' ') : undefined;
}

/** A username field: 54px, 16px text, no autocorrect or capitals (iOS would turn «olya» into «Olya»). */
export function UsernameInput({ className, ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return (
    <input
      className={className ? `${s.input} ${s.plain} ${className}` : `${s.input} ${s.plain}`}
      type="text"
      name="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      maxLength={64}
      {...rest}
    />
  );
}

export interface PasswordInputProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  /** Shown as plain text. */
  visible: boolean;
  /** Adds the eye button (one per form: it reveals the repeat field too). */
  onToggle?: () => void;
}

export function PasswordInput({ id, visible, onToggle, ...rest }: PasswordInputProps) {
  return (
    <div className={s.control}>
      <input
        id={id}
        className={onToggle ? s.input : `${s.input} ${s.plain}`}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={PASSWORD_LIMITS.max}
        {...rest}
      />
      {onToggle ? (
        <button
          type="button"
          className={s.toggle}
          aria-label="Показати пароль"
          aria-pressed={visible}
          aria-controls={id}
          // Keep focus (and the iPhone keyboard) in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
        >
          <EyeIcon crossed={visible} />
        </button>
      ) : null}
    </div>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

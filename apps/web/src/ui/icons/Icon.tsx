import { ICON_PATHS, type IconName } from './paths';

export interface IconProps {
  name: IconName;
  /** Rendered size in px (default 24). The glyph is always drawn on the 24×24 grid. */
  size?: 16 | 20 | 22 | 24;
  className?: string;
}

/** Decorative line icon in `currentColor` (1.8px stroke, round caps). Name the control around it, not the icon. */
export function Icon({ name, size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

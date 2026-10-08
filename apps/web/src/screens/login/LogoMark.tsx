import s from './LogoMark.module.css';

/** The «Л» app mark (rounded solid square), as on the sidebar and the home-screen icon. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={className ? `${s.mark} ${className}` : s.mark} aria-hidden="true">
      Л
    </div>
  );
}

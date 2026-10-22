import { BrandMark } from '@/shell/BrandMark';

/** The «Home Fit» app mark, as on the sidebar and the home-screen icon. */
export function LogoMark({ className }: { className?: string }) {
  return <BrandMark size={56} className={className} />;
}

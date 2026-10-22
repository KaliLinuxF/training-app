import { Button, Card } from '@/ui';
import { COACH_COPY } from './copy';
import s from './LoadState.module.css';

export type LoadStateKind = 'loading' | 'error' | 'offline';

/** «Завантажую…», «Не вдалося завантажити» / «Потрібен інтернет» + «Спробувати ще раз» (§6.8). */
export function LoadState({ kind, onRetry }: { kind: LoadStateKind; onRetry: () => void }) {
  if (kind === 'loading') {
    return (
      <Card as="section" aria-label={COACH_COPY.loading} className={s.card}>
        <p className={s.text} role="status">
          {COACH_COPY.loading}
        </p>
      </Card>
    );
  }
  const text = kind === 'offline' ? COACH_COPY.offline : COACH_COPY.loadFailed;
  return (
    <Card as="section" aria-label={text} className={s.card}>
      <p className={s.text} role={kind === 'offline' ? 'status' : 'alert'}>
        {text}
      </p>
      <Button variant="outline" fullWidth onClick={onRetry}>
        {COACH_COPY.retry}
      </Button>
    </Card>
  );
}

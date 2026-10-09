import { useState } from 'react';
import { useAuth } from '@/auth/auth';
import { ui } from '@/store/ui';
import { Button } from '@/ui';
import s from './AccountFooter.module.css';

/** «Вийти» and the tiny app footer at the bottom of the screen (full width). */
export function AccountFooter() {
  const { logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  const onLogout = () => {
    setLeaving(true);
    logout()
      .catch(() => {
        ui.flash('Не вдалося вийти. Спробуй ще раз', 3200);
        return false;
      })
      .finally(() => setLeaving(false));
  };

  return (
    <footer className={s.footer}>
      <Button variant="outline" className={s.logout} onClick={onLogout} disabled={leaving}>
        {leaving ? 'Виходжу…' : 'Вийти'}
      </Button>
      <p className={s.caption}>Легко · трекер схуднення</p>
    </footer>
  );
}

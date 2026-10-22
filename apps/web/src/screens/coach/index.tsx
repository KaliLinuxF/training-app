import { ClientScreen } from './ClientScreen';
import { ClientsScreen } from './ClientsScreen';
import { CoachGate } from './CoachGate';

/** `/coach`: the clients table / list (admins only). */
export function CoachClientsScreen() {
  return (
    <CoachGate>
      <ClientsScreen />
    </CoachGate>
  );
}

/** `/coach/:id`: one client, read-only (admins only). */
export function CoachClientScreen() {
  return (
    <CoachGate>
      <ClientScreen />
    </CoachGate>
  );
}

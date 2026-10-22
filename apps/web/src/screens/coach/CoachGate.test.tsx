import { cleanup, screen } from '@testing-library/react';
import { Route, Switch } from 'wouter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/App';
import { authActions } from '@/auth/auth';
import { ApiError, api } from '@/lib/api';
import { clientsPayload, meals, NOW, client } from './coach.fixtures';
import { at, desktop, freezeClock, location, mockClient, mockClients, renderPage, settle, signIn } from './coach.testing';
import { CoachClientScreen, CoachClientsScreen } from './index';

function routes() {
  return (
    <Switch>
      <Route path="/coach" component={CoachClientsScreen} />
      <Route path="/coach/:id" component={CoachClientScreen} />
      <Route path="/">
        <p>Головна</p>
      </Route>
    </Switch>
  );
}

beforeEach(() => {
  freezeClock();
  desktop(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  signIn(null);
  window.history.replaceState(null, '', '/');
});

describe('CoachGate', () => {
  it('renders nothing (and asks nothing) while the account is not known yet', async () => {
    signIn(null);
    const spy = mockClients(clientsPayload());
    at('/coach');
    const { container } = renderPage(routes());
    await settle();
    expect(container.textContent).toBe('');
    expect(spy).not.toHaveBeenCalled();
    expect(location()).toBe('/coach');
  });

  it('sends a user home from the list and from a client page, without asking the coach API', async () => {
    signIn('user');
    const list = mockClients(clientsPayload());
    const one = mockClient({ client: client(4, 'sofia'), data: meals() });
    at('/coach');
    renderPage(routes());
    await settle();
    expect(location()).toBe('/');
    expect(screen.getByText('Головна')).toBeTruthy();
    cleanup();

    at(`/coach/${client(4, 'sofia').id}`);
    renderPage(routes());
    await settle();
    expect(location()).toBe('/');
    expect(list).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
  });

  it('shows an admin the screen', async () => {
    signIn('admin');
    mockClients(clientsPayload());
    at('/coach');
    renderPage(routes());
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Клієнти' })).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('on a 403 asks who is signed in, then leaves for home', async () => {
    signIn('admin');
    const refresh = vi.spyOn(authActions, 'refreshUser').mockResolvedValue();
    vi.spyOn(api.coach, 'clients').mockRejectedValue(new ApiError(403, 'forbidden', 'Немає доступу'));
    at('/coach');
    renderPage(routes());
    await settle();
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    expect(location()).toBe('/');
  });
});

describe('App routes', () => {
  it('serve /coach and /coach/:id to an admin', async () => {
    signIn('admin');
    mockClients(clientsPayload(NOW));
    at('/coach');
    renderPage(<AppRoutes />);
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Клієнти' })).toBeTruthy();
    cleanup();

    const sofia = client(4, 'sofia');
    mockClient({ client: sofia, data: meals() });
    at(`/coach/${sofia.id}`);
    renderPage(<AppRoutes />);
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'sofia' })).toBeTruthy();
  });
});

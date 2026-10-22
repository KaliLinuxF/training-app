import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { adminInvite as invite, adminUser, at } from './testing';
import {
  adminErrorText,
  AI_LIMIT_STEPS,
  aiTodayLine,
  defaultLimitText,
  deleteNameMatches,
  disableConfirm,
  estimatesCount,
  inviteSub,
  inviteTitle,
  isLastUsableAdmin,
  linkExpiryLine,
  REVOKE_CONFIRM,
  roleConfirm,
  shareData,
  stepLimit,
  userFacts,
  userPills,
  userRowSub,
} from './usersModel';

const NOW = at(2026, 10, 22, 10, 0);

describe('invites', () => {
  it('titles a pending invite by its note, «Без підпису» without one', () => {
    expect(inviteTitle(invite())).toBe('для Олі');
    expect(inviteTitle(invite({ note: '' }))).toBe('Без підпису');
    expect(inviteTitle(invite({ note: '   ' }))).toBe('Без підпису');
  });

  it('says until when and from whom — «з консолі» for a CLI invite', () => {
    expect(inviteSub(invite())).toBe('до 28 жовтня · від admin');
    expect(inviteSub(invite({ createdBy: 'owner.2' }))).toBe('до 28 жовтня · від owner.2');
    expect(inviteSub(invite({ createdBy: null }))).toBe('до 28 жовтня · з консолі');
  });

  it('asks before revoking, with «Залишити» as the way out', () => {
    expect(REVOKE_CONFIRM).toEqual({
      title: 'Скасувати запрошення?',
      body: 'Посилання перестане працювати.',
      confirmLabel: 'Скасувати запрошення',
      cancelLabel: 'Залишити',
      destructive: true,
    });
  });
});

describe('link card copy', () => {
  const expires = at(2026, 10, 28, 14, 5);

  it('states when the link stops working, worded like the invite / reset pages (one-time first)', () => {
    expect(linkExpiryLine('invite', expires)).toBe('Одноразове, діє до 28 жовтня, 14:05.');
    expect(linkExpiryLine('reset', expires)).toBe(
      'Одноразове, діє 24 години. Старий пароль працює, доки посиланням не скористаються.',
    );
    // An account without a password has no old one to keep working.
    expect(linkExpiryLine('setup', expires)).toBe('Одноразове, діє 24 години.');
  });

  it('shares a self-explaining text with the link (messengers drop the title)', () => {
    const url = 'https://fit.triple-a.dev/invite#tok';
    // «Home Fit» without quotes, as in the invite page's «Запрошення в Home Fit».
    expect(shareData('invite', url, expires)).toEqual({
      title: 'Запрошення в Home Fit',
      text: 'Запрошую в Home Fit — трекер схуднення. Посилання одноразове, діє до 28 жовтня.',
      url,
    });
    for (const purpose of ['reset', 'setup'] as const) {
      expect(shareData(purpose, url, expires)).toEqual({
        title: 'Новий пароль у Home Fit',
        text: 'Посилання для нового пароля в Home Fit, діє 24 години.',
        url,
      });
    }
  });
});

describe('accounts', () => {
  it('finds the last usable admin (active, with a password)', () => {
    const admin = adminUser('admin', { role: 'admin', self: true });
    const anna = adminUser('anna');
    expect(isLastUsableAdmin(admin, [admin, anna])).toBe(true);
    expect(isLastUsableAdmin(anna, [admin, anna])).toBe(false);
    const second = adminUser('boss', { role: 'admin' });
    expect(isLastUsableAdmin(admin, [admin, second, anna])).toBe(false);
    // A disabled admin or one without a password does not count as a second one.
    for (const status of ['disabled', 'pending'] as const) {
      const other = adminUser('boss', { role: 'admin', status });
      expect(isLastUsableAdmin(admin, [admin, other]), status).toBe(true);
      expect(isLastUsableAdmin(other, [admin, other]), status).toBe(false);
    }
  });

  it('labels admins, disabled accounts and accounts without a password', () => {
    expect(userPills(adminUser('anna'))).toEqual([]);
    expect(userPills(adminUser('admin', { role: 'admin' }))).toEqual([{ text: 'Адмін', tone: 'acc' }]);
    expect(userPills(adminUser('olya', { status: 'disabled' }))).toEqual([
      { text: 'Вимкнено', tone: 'neutral' },
    ]);
    expect(userPills(adminUser('new', { status: 'pending' }))).toEqual([
      { text: 'Пароль не задано', tone: 'neutral' },
    ]);
    expect(userPills(adminUser('boss', { role: 'admin', status: 'disabled' })).map((p) => p.text)).toEqual([
      'Адмін',
      'Вимкнено',
    ]);
  });

  it('counts the estimates with Ukrainian plurals', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(estimatesCount)).toEqual([
      '1 підрахунок',
      '2 підрахунки',
      '4 підрахунки',
      '5 підрахунків',
      '11 підрахунків',
      '12 підрахунків',
      '14 підрахунків',
      '21 підрахунок',
      '22 підрахунки',
      '25 підрахунків',
      '101 підрахунок',
      '111 підрахунків',
    ]);
  });

  it('words the activity line (never «Останній вхід»), adding today’s estimates only when there are some', () => {
    expect(userRowSub(adminUser('admin', { self: true, lastSeenAt: at(2026, 10, 22, 9, 0) }), NOW)).toBe(
      'Це ти · активність сьогодні',
    );
    expect(userRowSub(adminUser('anna', { lastSeenAt: at(2026, 10, 22, 8, 0) }), NOW)).toBe(
      'Активність сьогодні',
    );
    expect(
      userRowSub(
        adminUser('anna', {
          lastSeenAt: at(2026, 10, 21, 8, 0),
          ai: { today: 3, last30Days: 41, limit: 40, customLimit: null },
        }),
        NOW,
      ),
    ).toBe('Активність вчора · 3 підрахунки сьогодні');
    expect(
      userRowSub(
        adminUser('admin', {
          self: true,
          lastSeenAt: at(2026, 10, 22, 9, 0),
          ai: { today: 1, last30Days: 1, limit: 40, customLimit: null },
        }),
        NOW,
      ),
    ).toBe('Це ти · активність сьогодні · 1 підрахунок сьогодні');
    expect(userRowSub(adminUser('olya', { lastSeenAt: at(2026, 10, 2, 8, 0) }), NOW)).toBe(
      'Активність 2 жовтня',
    );
    expect(userRowSub(adminUser('new'), NOW)).toBe('Ще не входили');
    // The server clock is ahead of this device: the date, not a negative count.
    expect(userRowSub(adminUser('anna', { lastSeenAt: at(2026, 10, 24, 8, 0) }), NOW)).toBe(
      'Активність 24 жовтня',
    );
  });

  it('lists the facts of the user sheet', () => {
    const anna = adminUser('anna', {
      lastSeenAt: at(2026, 10, 22, 9, 12),
      ai: { today: 3, last30Days: 41, limit: 40, customLimit: null },
    });
    expect(userFacts(anna, NOW)).toEqual({
      since: 'Користувач · з 9 жовтня 2026',
      activity: 'Активність: сьогодні, 09:12',
      ai: 'Підрахунки: сьогодні 3 · за 30 днів 41',
    });
    expect(userFacts(adminUser('admin', { role: 'admin' }), NOW)).toEqual({
      since: 'Адміністратор · з 9 жовтня 2026',
      activity: 'Ще не входили',
      ai: 'Підрахунки: сьогодні 0 · за 30 днів 0',
    });
  });

  it('asks before a role change, honestly about what an admin can do', () => {
    expect(roleConfirm('anna', 'admin', false)).toEqual({
      title: 'Зробити anna адміністратором?',
      body:
        'Адміністратор бачить усі акаунти, а також записи й прогрес кожного користувача — лише для перегляду, ' +
        'змінити їх він не може. Він запрошує, вимикає й видаляє акаунти та може видати посилання для нового ' +
        'пароля — людина про це дізнається.',
      confirmLabel: 'Зробити адміністратором',
    });
    expect(roleConfirm('boss', 'user', false)).toEqual({
      title: 'Забрати права адміністратора в boss?',
      body: 'Розділи «Користувачі» й «Клієнти» зникнуть для цього акаунта, а його записи й прогрес бачитимуть адміністратори.',
      confirmLabel: 'Забрати права',
      destructive: true,
    });
    expect(roleConfirm('admin', 'user', true).title).toBe('Забрати права адміністратора в себе?');
  });

  it('asks before disabling', () => {
    expect(disableConfirm('anna')).toEqual({
      title: 'Вимкнути акаунт anna?',
      body:
        'Увійти в нього буде неможливо, усі його пристрої вийдуть з акаунта, нагадування зупиняться. Записи ' +
        'збережуться — акаунт можна знову ввімкнути.',
      confirmLabel: 'Вимкнути',
      destructive: true,
    });
  });

  it('matches the typed name case-insensitively, ignoring surrounding spaces', () => {
    expect(deleteNameMatches('anna', 'anna')).toBe(true);
    expect(deleteNameMatches('ANNA', 'anna')).toBe(true);
    expect(deleteNameMatches(' Olya.K ', 'olya.k')).toBe(true);
    expect(deleteNameMatches('ann', 'anna')).toBe(false);
    expect(deleteNameMatches('', 'anna')).toBe(false);
    expect(deleteNameMatches('anna2', 'anna')).toBe(false);
  });
});

describe('AI limits', () => {
  it('steps onto the grid and stays in range', () => {
    const per = AI_LIMIT_STEPS.perUser;
    const all = AI_LIMIT_STEPS.global;
    expect(per).toEqual({ min: 0, max: 1000, step: 5 });
    expect(all).toEqual({ min: 0, max: 10_000, step: 10 });
    expect(stepLimit(40, 1, per)).toBe(45);
    expect(stepLimit(40, -1, per)).toBe(35);
    expect(stepLimit(42, 1, per)).toBe(45);
    expect(stepLimit(42, -1, per)).toBe(40);
    expect(stepLimit(0, -1, per)).toBe(0);
    expect(stepLimit(5, -1, per)).toBe(0);
    expect(stepLimit(1000, 1, per)).toBe(1000);
    expect(stepLimit(998, 1, per)).toBe(1000);
    expect(stepLimit(150, 1, all)).toBe(160);
    expect(stepLimit(10_000, 1, all)).toBe(10_000);
    expect(stepLimit(9_995, 1, all)).toBe(10_000);
  });

  it('says the default and today’s use', () => {
    expect(defaultLimitText(40)).toBe('Як у всіх: 40 на день');
    expect(aiTodayLine(12, 150)).toBe('Сьогодні використано 12 з 150.');
  });
});

describe('admin errors', () => {
  const err = (code: ConstructorParameters<typeof ApiError>[1], status = 409) =>
    new ApiError(status, code, 'x');

  it('maps the server codes to Ukrainian', () => {
    expect(adminErrorText(err('last_admin'), 'user')).toBe('Це єдиний адміністратор');
    expect(adminErrorText(err('self_action'), 'user')).toBe('Із власним акаунтом так не можна');
    expect(adminErrorText(err('account_disabled'), 'user')).toBe('Акаунт вимкнено — спершу ввімкни його');
    expect(adminErrorText(err('limit_reached'), 'invite')).toBe('Забагато активних запрошень — скасуй старі');
    expect(adminErrorText(err('not_found', 404), 'revoke')).toBe(
      'Це запрошення вже використали або скасували',
    );
    expect(adminErrorText(err('not_found', 404), 'user')).toBe('Цього акаунта вже немає');
    expect(adminErrorText(err('bad_request', 400), 'delete')).toBe('Імʼя для підтвердження не збігається');
    expect(adminErrorText(err('bad_request', 400), 'limits')).toBe('Щось пішло не так');
    expect(adminErrorText(err('rate_limited', 429), 'invite')).toBe(
      'Забагато спроб — спробуй за кілька хвилин',
    );
    expect(adminErrorText(new ApiError(0, 'network', 'x'), 'user')).toBe('Немає зʼєднання з сервером');
    expect(adminErrorText(err('internal', 500), 'user')).toBe('Немає зʼєднання з сервером');
    expect(adminErrorText(new Error('boom'), 'user')).toBe('Щось пішло не так');
  });
});

import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { at } from '../users/testing';
import {
  ACCOUNT_COPY,
  ACCOUNT_ERRORS,
  aiLeftText,
  avatarLetter,
  checkPasswordForm,
  checkRenameForm,
  passwordErrorFrom,
  profileLine,
  provenanceLine,
  renameErrorFrom,
} from './accountModel';

const NOW = at(2026, 10, 22, 10, 0);
const err = (code: ConstructorParameters<typeof ApiError>[1], status = 400) =>
  new ApiError(status, code, 'x');

describe('profile', () => {
  it('says the role and since when', () => {
    expect(profileLine({ role: 'user', createdAt: at(2026, 10, 9) })).toBe('Користувач · з 9 жовтня 2026');
    expect(profileLine({ role: 'admin', createdAt: at(2026, 10, 21) })).toBe(
      'Адміністратор · з 21 жовтня 2026',
    );
  });

  it('tells a user the admin sees their records (docs/coach-cabinet.md §7.1)', () => {
    expect(ACCOUNT_COPY.adminSees).toBe('Адміністратор бачить твої записи та прогрес.');
  });

  it('puts the first letter of the name, upper case, in the avatar', () => {
    expect(avatarLetter('anna')).toBe('A');
    expect(avatarLetter('olya.k')).toBe('O');
    expect(avatarLetter(' 7days')).toBe('7');
    expect(avatarLetter('')).toBe('?');
  });
});

describe('password provenance (D28)', () => {
  it('is empty when nothing is known', () => {
    expect(provenanceLine(null, NOW)).toBeNull();
  });

  it('names who made the link that set it — or the console, or the server', () => {
    const day = at(2026, 10, 21, 9, 30);
    expect(provenanceLine({ at: day, via: 'self', by: null }, NOW)).toBe('Пароль змінено 21 жовтня.');
    expect(provenanceLine({ at: day, via: 'reset', by: 'admin' }, NOW)).toBe(
      'Пароль задано 21 жовтня за посиланням від admin.',
    );
    expect(provenanceLine({ at: day, via: 'setup', by: 'boss' }, NOW)).toBe(
      'Пароль задано 21 жовтня за посиланням від boss.',
    );
    expect(provenanceLine({ at: day, via: 'reset', by: null }, NOW)).toBe(
      'Пароль задано 21 жовтня за посиланням з консолі.',
    );
    expect(provenanceLine({ at: day, via: 'setup', by: null }, NOW)).toBe(
      'Пароль задано 21 жовтня за посиланням з консолі.',
    );
    expect(provenanceLine({ at: day, via: 'cli', by: null }, NOW)).toBe(
      'Пароль задано 21 жовтня на сервері.',
    );
  });

  it('adds the year outside the current one; a date after «now» is still just a date', () => {
    expect(provenanceLine({ at: at(2025, 3, 2), via: 'self', by: null }, NOW)).toBe(
      'Пароль змінено 2 березня 2025.',
    );
    expect(provenanceLine({ at: at(2026, 10, 25), via: 'cli', by: null }, NOW)).toBe(
      'Пароль задано 25 жовтня на сервері.',
    );
  });
});

describe('AI left today', () => {
  it('says «з L» only when the server sends the limit', () => {
    expect(aiLeftText({ remainingToday: 37, limitToday: 40 })).toBe('Сьогодні ще 37 з 40');
    expect(aiLeftText({ remainingToday: 37 })).toBe('Сьогодні ще 37');
    expect(aiLeftText({ remainingToday: 0, limitToday: 40 })).toBe('Сьогодні ще 0 з 40');
    expect(aiLeftText({ remainingToday: -2, limitToday: 40 })).toBe('Сьогодні ще 0 з 40');
    expect(aiLeftText({ remainingToday: Number.NaN })).toBe('Сьогодні ще 0');
  });
});

describe('change password form', () => {
  it('asks for the current password, 8+ characters and the same repeat', () => {
    expect(checkPasswordForm({ current: '', next: 'long-enough', repeat: 'long-enough' })).toEqual({
      field: 'current',
      text: 'Введи поточний пароль',
    });
    expect(checkPasswordForm({ current: 'old', next: 'short', repeat: 'short' })).toEqual({
      field: 'next',
      text: 'Новий пароль — щонайменше 8 символів',
    });
    expect(checkPasswordForm({ current: 'old', next: 'long-enough', repeat: 'long-enougH' })).toEqual({
      field: 'repeat',
      text: 'Паролі не збігаються',
    });
    expect(checkPasswordForm({ current: 'old', next: '12345678', repeat: '12345678' })).toBeNull();
  });

  it('maps the server answers', () => {
    expect(passwordErrorFrom(err('wrong_password', 403))).toEqual({
      field: 'current',
      text: 'Поточний пароль неправильний',
    });
    expect(passwordErrorFrom(err('weak_password'))).toEqual({
      field: 'next',
      text: 'Новий пароль — щонайменше 8 символів',
    });
    expect(passwordErrorFrom(err('rate_limited', 429))).toEqual({
      field: null,
      text: 'Забагато спроб — спробуй за кілька хвилин',
    });
    expect(passwordErrorFrom(new ApiError(0, 'network', 'x'))).toEqual({
      field: null,
      text: 'Немає зʼєднання з сервером',
    });
    expect(passwordErrorFrom(new Error('?'))).toEqual({ field: null, text: 'Щось пішло не так' });
  });
});

describe('rename form', () => {
  it('checks the name rule, the reserved names and the password', () => {
    expect(checkRenameForm({ username: 'anna', password: '' }, 'anna')).toBe('unchanged');
    expect(checkRenameForm({ username: ' anna ', password: '' }, 'anna')).toBe('unchanged');
    // Another case is a rename (the name is shown as typed).
    expect(checkRenameForm({ username: 'Anna', password: 'pw' }, 'anna')).toBeNull();
    expect(checkRenameForm({ username: 'an', password: 'pw' }, 'anna')).toEqual({
      field: 'username',
      text: ACCOUNT_ERRORS.invalidUsername,
    });
    expect(checkRenameForm({ username: 'анна', password: 'pw' }, 'anna')).toEqual({
      field: 'username',
      text: 'Імʼя: 3–32 символи — латинські літери, цифри, крапка\u00A0(.), дефіс\u00A0(-) або підкреслення\u00A0(_)',
    });
    expect(checkRenameForm({ username: '...', password: 'pw' }, 'anna')).toEqual({
      field: 'username',
      text: ACCOUNT_ERRORS.invalidUsername,
    });
    for (const reserved of ['admin', 'Admin', 'legko', 'LEGKO']) {
      expect(checkRenameForm({ username: reserved, password: 'pw' }, 'anna'), reserved).toEqual({
        field: 'username',
        text: 'Це імʼя зарезервоване — обери інше',
      });
    }
    expect(checkRenameForm({ username: 'anna.k', password: '' }, 'anna')).toEqual({
      field: 'password',
      text: 'Введи пароль',
    });
    expect(checkRenameForm({ username: 'anna.k', password: 'pw' }, 'anna')).toBeNull();
  });

  it('maps the server answers', () => {
    expect(renameErrorFrom(err('wrong_password', 403))).toEqual({
      field: 'password',
      text: 'Пароль неправильний',
    });
    expect(renameErrorFrom(err('username_taken', 409))).toEqual({
      field: 'username',
      text: 'Це імʼя вже зайняте',
    });
    expect(renameErrorFrom(err('invalid_username'))).toEqual({
      field: 'username',
      text: ACCOUNT_ERRORS.invalidUsername,
    });
    expect(renameErrorFrom(err('rate_limited', 429))).toEqual({
      field: null,
      text: 'Забагато спроб — спробуй за кілька хвилин',
    });
    expect(renameErrorFrom(err('outdated_server', 200))).toEqual({ field: null, text: 'Щось пішло не так' });
  });
});

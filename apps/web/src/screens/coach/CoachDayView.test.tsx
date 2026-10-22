import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhotoUrlsProvider } from '@/lib/photoUrls';
import { meals, PHOTO_IDS, steady, TODAY } from './coach.fixtures';
import { renderPage } from './coach.testing';
import { CoachDayView } from './CoachDayView';
import { coachPhotoUrls } from './nav';

afterEach(cleanup);

const ID = 'c0ac0000000000000000000000000004';

describe('CoachDayView', () => {
  it('shows a day with no button and no «Додати» anywhere', () => {
    const { container } = renderPage(<CoachDayView data={steady()} date="2026-10-12" today={TODAY} />);
    expect(container.textContent).not.toMatch(/додати/i);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: '12 жовтня 2026' })).toBeTruthy();
    expect(container.textContent).toContain('69,6 кг');
    expect(container.textContent).toContain('Груди 92 · Талія 76 · Стегна 100');
    expect(screen.getByRole('region', { name: 'Підсумок дня' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Тренування' })).toBeNull();
  });

  it('shows an untouched row as a faint «—» and the training text as it is', () => {
    const { container } = renderPage(<CoachDayView data={steady()} date="2026-10-13" today={TODAY} />);
    expect(container.textContent).toContain('Ще не відмічено');
    expect(container.textContent).toMatch(/Вага\s*—/);
    expect(container.textContent).not.toMatch(/додати/i);
  });

  it('lists every meal with its macros and its photos (coach URLs); the thumbnails are the only buttons', () => {
    renderPage(
      <PhotoUrlsProvider value={coachPhotoUrls(ID)}>
        <CoachDayView data={meals()} date="2026-10-13" today={TODAY} />
      </PhotoUrlsProvider>,
    );
    const list = screen.getByRole('region', { name: 'Прийоми їжі' });
    expect(list.textContent).toContain('Сніданок · 08:30');
    expect(list.textContent).toContain('Обід · 13:10');
    expect(list.textContent).toMatch(/Б\s28\s·\sЖ\s22\s·\sВ\s80\sг/);
    const imgs = within(list).getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(
      PHOTO_IDS.map((p) => `/api/coach/clients/${ID}/photos/${p}/thumb`),
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(PHOTO_IDS.length);
    for (const b of buttons) expect(b.getAttribute('aria-haspopup')).toBe('dialog');
    expect(document.body.textContent).not.toMatch(/додати/i);
    expect(screen.getByText('Кардіо')).toBeTruthy();
  });

  it('says so on a day with nothing recorded', () => {
    const { container } = renderPage(<CoachDayView data={steady()} date={TODAY} today={TODAY} />);
    expect(screen.getByText('Цього дня нічого не записано')).toBeTruthy();
    expect(screen.getByText('Порожньо')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Прийоми їжі' })).toBeNull();
    expect(container.textContent).not.toMatch(/додати/i);
  });
});

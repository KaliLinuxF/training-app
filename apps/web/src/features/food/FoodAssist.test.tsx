import type { FoodEstimateRequest, FoodEstimateResponse, FoodItem } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { deferred } from '@/store/test-utils';
import type { EstimateDeps } from './estimate';
import { FoodAssist } from './FoodAssist';
import { resetFoodStatus } from './foodStatus';
import type { PhotoDeps } from './image';

const store = vi.hoisted(() => ({ foods: [] as FoodItem[], online: true, commit: vi.fn() }));

vi.mock('@/store/data', () => ({
  useAppData: () => ({ foods: store.foods }),
  useSyncState: () => ({ online: store.online }),
  commit: store.commit,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof ApiModule>();
  return {
    ...orig,
    api: { foodStatus: vi.fn(() => new Promise(() => undefined)), foodEstimate: vi.fn() },
  };
});

const TODAY = '2026-10-09';

const RESULT: FoodEstimateResponse = {
  photoId: null,
  items: [
    { name: 'Борщ', portion: '300 г', kcal: 260 },
    { name: 'Хліб', portion: '1 скибка', kcal: 80 },
  ],
  totalKcal: 340,
  comment: 'Порції приблизні.',
};

type EstimateFn = (req: FoodEstimateRequest, signal?: AbortSignal) => Promise<FoodEstimateResponse>;

function setup(estimate: EstimateFn, photo?: PhotoDeps) {
  const onAdd = vi.fn();
  const notify = vi.fn();
  const estimateMock = vi.fn(estimate);
  const deps: EstimateDeps = { estimate: estimateMock, notify, ...(photo ? { photo } : {}) };
  render(<FoodAssist date={TODAY} onAdd={onAdd} estimateDeps={deps} />);
  return { onAdd, notify, estimate: estimateMock };
}

beforeEach(() => {
  store.foods = [];
  store.online = true;
  store.commit.mockReset();
  resetFoodStatus({ enabled: true, remainingToday: 42 });
});

afterEach(cleanup);

describe('FoodAssist', () => {
  it('estimates a description, lets her adjust it and adds it to the day', async () => {
    const { onAdd, estimate } = setup(async () => RESULT);

    const toggle = screen.getByRole('button', { name: 'Порахувати калорії' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const input = screen.getByRole('textbox', { name: 'Що порахувати' });
    expect(input.getAttribute('placeholder')).toBe('Напр.: борщ 300 г, 2 скибки хліба, салат');
    const submit = screen.getByRole('button', { name: 'Порахувати' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'борщ і хліб' } });
    fireEvent.click(submit);

    expect(estimate).toHaveBeenCalledWith({ date: TODAY, text: 'борщ і хліб' }, expect.any(AbortSignal));
    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    expect(screen.getByText('Порції приблизні.')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Хліб ккал' }), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати 420 ккал' }));

    expect(onAdd).toHaveBeenCalledWith({
      line: 'Борщ (300 г), хліб (1 скибка) — 420 ккал',
      kcal: 420,
      photoId: null,
      items: [
        { name: 'Борщ', portion: '300 г', kcal: 260 },
        { name: 'Хліб', portion: '1 скибка', kcal: 160 },
      ],
    });
    expect(store.commit).toHaveBeenCalledWith(
      { kind: 'food.use', date: TODAY, value: { name: 'Борщ', portion: '300 г', kcal: 260 } },
      { kind: 'food.use', date: TODAY, value: { name: 'Хліб', portion: '1 скибка', kcal: 160 } },
    );
    // Back to the closed state, composer cleared.
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Що порахувати' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Порахувати калорії' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter in the composer submits', () => {
    const { estimate } = setup(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати калорії' }));
    const input = screen.getByRole('textbox', { name: 'Що порахувати' });
    fireEvent.change(input, { target: { value: 'салат' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(estimate).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Рахую калорії…');
  });

  it('«Скасувати» while loading aborts and ignores the late answer', async () => {
    const answer = deferred<FoodEstimateResponse>();
    let signal: AbortSignal | undefined;
    const { onAdd } = setup((_req, s) => {
      signal = s;
      return answer.promise;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати калорії' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Що порахувати' }), { target: { value: 'піца' } });
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати' }));
    // The action buttons are locked while a request runs.
    expect((screen.getByRole('button', { name: 'Порахувати калорії' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => answer.resolve(RESULT));
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    // The composer keeps the text for another try.
    expect((screen.getByRole('textbox', { name: 'Що порахувати' }) as HTMLTextAreaElement).value).toBe('піца');
  });

  it('server errors become a Ukrainian toast; rate limiting locks the buttons', async () => {
    const { notify } = setup(async () => {
      throw new ApiError(429, 'rate_limited', 'limit');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати калорії' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Що порахувати' }), { target: { value: 'борщ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Ліміт підрахунків на сьогодні вичерпано'));
    expect(screen.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Порахувати' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Порахувати калорії за фото' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // The open composer can still be folded away, then the toggle is locked too.
    const toggle = screen.getByRole('button', { name: 'Порахувати калорії' }) as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(screen.queryByRole('textbox', { name: 'Що порахувати' })).toBeNull();
    expect(toggle.disabled).toBe(true);
  });

  it('a photo is downscaled on the device and estimated right away with the composer text as a hint', async () => {
    const photo: PhotoDeps = {
      decode: async () => ({ source: {} as CanvasImageSource, width: 4000, height: 3000, release: () => undefined }),
      encode: async (_src, size) => ({ canvas: {} as CanvasImageSource, blob: new Blob([`${size.width}`]) }),
      toBase64: async (blob) => `b64-${await blob.text()}`,
    };
    const { estimate, onAdd } = setup(async () => ({ ...RESULT, photoId: 'ph_0123456789abcdef' }), photo);

    fireEvent.click(screen.getByRole('button', { name: 'Порахувати калорії' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Що порахувати' }), { target: { value: 'без сметани' } });
    const file = new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.hasAttribute('capture')).toBe(false);
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    expect(estimate).toHaveBeenCalledWith(
      { date: TODAY, text: 'без сметани', image: { full: 'b64-1280', thumb: 'b64-320' } },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('img', { name: 'Фото їжі' }).getAttribute('src')).toBe('data:image/jpeg;base64,b64-320');
    fireEvent.click(screen.getByRole('button', { name: 'Додати 340 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'ph_0123456789abcdef', kcal: 340 }));
  });

  it('a file that is not a photo is rejected without a request', async () => {
    const { estimate, notify } = setup(async () => RESULT);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Це не схоже на фото'));
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offline: buttons disabled with a hint; chips still work', () => {
    store.online = false;
    store.foods = [{ name: 'Сирники', portion: '3 шт', kcal: 450, count: 2, lastUsed: '2026-10-01' }];
    const { onAdd } = setup(async () => RESULT);
    expect((screen.getByRole('button', { name: 'Порахувати калорії' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Порахувати калорії за фото' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Потрібен інтернет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Додати Сирники · 450 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ line: 'Сирники (3 шт) — 450 ккал' }));
  });

  it('AI disabled on the server: no AI buttons, only the chips', () => {
    resetFoodStatus({ enabled: false, remainingToday: 0 });
    store.foods = [{ name: 'Сирники', portion: '3 шт', kcal: 450, count: 2, lastUsed: '2026-10-01' }];
    setup(async () => RESULT);
    expect(screen.queryByRole('button', { name: 'Порахувати калорії' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Порахувати калорії за фото' })).toBeNull();
    expect(screen.getByText('Часті страви')).toBeTruthy();
  });

  it('nothing recognised → «Спробувати ще» reopens the composer', async () => {
    setup(async () => ({ photoId: null, items: [], totalKcal: 0, comment: 'Це не схоже на їжу.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати калорії' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Що порахувати' }), { target: { value: 'стіл' } });
    fireEvent.click(screen.getByRole('button', { name: 'Порахувати' }));
    await screen.findByText('Це не схоже на їжу.');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect((screen.getByRole('textbox', { name: 'Що порахувати' }) as HTMLTextAreaElement).value).toBe('стіл');
  });
});

import type { FoodEstimateRequest, FoodEstimateResponse, FoodItem } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { deferred } from '@/store/test-utils';
import type { EstimateDeps } from './estimate';
import { FoodAssist, type FoodAssistProps } from './FoodAssist';
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

const PHOTO: PhotoDeps = {
  decode: async () => ({ source: {} as CanvasImageSource, width: 4000, height: 3000, release: () => undefined }),
  encode: async (_src, size) => ({ canvas: {} as CanvasImageSource, blob: new Blob([`${size.width}`]) }),
  toBase64: async (blob) => `b64-${await blob.text()}`,
};

type EstimateFn = (req: FoodEstimateRequest, signal?: AbortSignal) => Promise<FoodEstimateResponse>;

interface SetupOptions {
  photo?: PhotoDeps;
  foodText?: string;
  date?: string;
}

function setup(estimate: EstimateFn, { photo, foodText = '', date = TODAY }: SetupOptions = {}) {
  const onAdd = vi.fn();
  const onPendingChange = vi.fn();
  const notify = vi.fn();
  const estimateMock = vi.fn(estimate);
  const deps: EstimateDeps = { estimate: estimateMock, notify, ...(photo ? { photo } : {}) };
  const props = (over: Partial<FoodAssistProps> = {}): FoodAssistProps => ({
    date,
    foodText,
    onAdd,
    onPendingChange,
    estimateDeps: deps,
    ...over,
  });
  const view = render(<FoodAssist {...props()} />);
  const rerender = (over: Partial<FoodAssistProps>) => view.rerender(<FoodAssist {...props(over)} />);
  /** The last pending state reported to the sheet. */
  const pending = () => onPendingChange.mock.lastCall?.[0] as boolean | undefined;
  return { onAdd, notify, estimate: estimateMock, rerender, pending };
}

const toggle = () => screen.getByRole('button', { name: 'Порахувати калорії' }) as HTMLButtonElement;
const composer = () => screen.getByRole('textbox', { name: 'Що порахувати' }) as HTMLTextAreaElement;
const submit = () => screen.getByRole('button', { name: 'Порахувати' }) as HTMLButtonElement;
const live = () => screen.getByRole('status');
const pickFile = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

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

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    expect(composer().getAttribute('placeholder')).toBe('Напр.: борщ 300 г, 2 скибки хліба, салат');
    expect(document.activeElement).toBe(composer());
    expect(submit().disabled).toBe(true);
    fireEvent.change(composer(), { target: { value: 'борщ і хліб' } });
    fireEvent.click(submit());

    expect(estimate).toHaveBeenCalledWith({ date: TODAY, text: 'борщ і хліб' }, expect.any(AbortSignal));
    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    expect(screen.getByText('Порції приблизні.')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Хліб ккал' }), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати 420 ккал' }));

    const items = [
      { name: 'Борщ', portion: '300 г', kcal: 260 },
      { name: 'Хліб', portion: '1 скибка', kcal: 160 },
    ];
    expect(onAdd).toHaveBeenCalledWith({
      line: 'Борщ (300 г), хліб (1 скибка) — 420 ккал',
      consumed: '',
      kcal: 420,
      photoId: null,
      items,
      uses: items,
    });
    // `food.use` is the sheet's job, on «Зберегти» — never committed from here.
    expect(store.commit).not.toHaveBeenCalled();
    // Back to the closed state, composer cleared.
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Що порахувати' })).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('«✨ Порахувати» pre-fills what she typed after the last estimate; left as is, the result replaces it', async () => {
    const { onAdd, estimate } = setup(async () => RESULT, { foodText: 'Кава — 60 ккал\nборщ\nхліб' });
    fireEvent.click(toggle());
    expect(composer().value).toBe('борщ, хліб');
    fireEvent.click(submit());
    expect(estimate).toHaveBeenCalledWith({ date: TODAY, text: 'борщ, хліб' }, expect.any(AbortSignal));
    fireEvent.click(await screen.findByRole('button', { name: 'Додати 340 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ consumed: 'борщ, хліб', kcal: 340 }));
  });

  it('an edited pre-fill is estimated as typed and the line is appended', async () => {
    const { onAdd, estimate } = setup(async () => RESULT, { foodText: 'борщ і хліб' });
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'борщ 300 г і хліб' } });
    fireEvent.click(submit());
    expect(estimate).toHaveBeenCalledWith({ date: TODAY, text: 'борщ 300 г і хліб' }, expect.any(AbortSignal));
    fireEvent.click(await screen.findByRole('button', { name: 'Додати 340 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ consumed: '' }));
  });

  it('folding the composer away keeps her own text; an untouched pre-fill follows the food text', () => {
    const { rerender } = setup(async () => RESULT, { foodText: 'борщ' });
    fireEvent.click(toggle());
    expect(composer().value).toBe('борщ');
    fireEvent.click(toggle());
    rerender({ foodText: 'борщ\nсалат' });
    fireEvent.click(toggle());
    expect(composer().value).toBe('борщ, салат');
    fireEvent.change(composer(), { target: { value: 'салат олівʼє' } });
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(composer().value).toBe('салат олівʼє');
  });

  it('Enter in the composer submits; progress is announced and focus waits on «Скасувати»', () => {
    const { estimate } = setup(() => new Promise(() => undefined));
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'салат' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(estimate).toHaveBeenCalledOnce();
    expect(live().textContent).toBe('Рахую калорії…');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Скасувати' }));
  });

  it('the result is announced and focus lands on its title; «Додати» is confirmed and focus returns', async () => {
    setup(async () => RESULT);
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'борщ' } });
    fireEvent.click(submit());
    const title = await screen.findByText('Оцінка калорій');
    expect(live().textContent).toBe('Знайдено 2 позиції, разом 340 ккал');
    expect(document.activeElement).toBe(title);

    fireEvent.click(screen.getByRole('button', { name: 'Додати 340 ккал' }));
    expect(live().textContent).toBe('Додано 340 ккал');
    expect(document.activeElement).toBe(toggle());
  });

  it('focus is left alone when she is working in another field by the time the result arrives', async () => {
    const answer = deferred<FoodEstimateResponse>();
    setup(() => answer.promise);
    const other = document.body.appendChild(document.createElement('input'));
    try {
      fireEvent.click(toggle());
      fireEvent.change(composer(), { target: { value: 'борщ' } });
      fireEvent.click(submit());
      other.focus();
      await act(async () => answer.resolve(RESULT));
      expect(screen.getByRole('heading', { name: 'Оцінка калорій' })).toBeTruthy();
      expect(document.activeElement).toBe(other);
    } finally {
      other.remove();
    }
  });

  it('«Скасувати» while loading aborts, ignores the late answer and returns to the composer', async () => {
    const answer = deferred<FoodEstimateResponse>();
    let signal: AbortSignal | undefined;
    const { onAdd } = setup((_req, s) => {
      signal = s;
      return answer.promise;
    });
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'піца' } });
    fireEvent.click(submit());
    // The action buttons are locked while a request runs.
    expect(toggle().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => answer.resolve(RESULT));
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    // The composer keeps the text for another try, and has the focus back.
    expect(composer().value).toBe('піца');
    expect(document.activeElement).toBe(composer());
  });

  it('a failed text estimate: advice for text, inline alert in the sheet, text kept', async () => {
    const { notify } = setup(async () => {
      throw new ApiError(502, 'ai_failed', 'Не вдалося порахувати калорії');
    });
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'щось дивне' } });
    fireEvent.click(submit());
    const message = 'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(composer().value).toBe('щось дивне');
    expect(document.activeElement).toBe(composer());

    // The next attempt clears it (and fails the same way).
    fireEvent.click(submit());
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
  });

  it('a failed photo estimate suggests describing it in words', async () => {
    const { notify } = setup(
      async () => {
        throw new ApiError(502, 'ai_failed', 'x');
      },
      { photo: PHOTO },
    );
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    const message = 'Не вдалося розпізнати — спробуй описати текстом';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message));
    expect(screen.getByRole('alert').textContent).toBe(message);
  });

  it('server errors become a Ukrainian toast; rate limiting locks the buttons', async () => {
    const { notify } = setup(async () => {
      throw new ApiError(429, 'rate_limited', 'limit');
    });
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'борщ' } });
    fireEvent.click(submit());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Ліміт підрахунків на сьогодні вичерпано'));
    // One line: the alert doubles as the hint the buttons are described by.
    const line = screen.getByText('Ліміт підрахунків на сьогодні вичерпано');
    expect(line.getAttribute('role')).toBe('alert');
    expect(screen.getByRole('button', { name: 'Порахувати калорії за фото' }).getAttribute('aria-describedby')).toBe(
      line.id,
    );
    expect(submit().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Порахувати калорії за фото' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // The open composer can still be folded away, then the toggle is locked too.
    fireEvent.click(toggle());
    expect(screen.queryByRole('textbox', { name: 'Що порахувати' })).toBeNull();
    expect(toggle().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeTruthy();
  });

  it('a photo is downscaled on the device and estimated right away with the composer text as a hint', async () => {
    const { estimate, onAdd } = setup(async () => ({ ...RESULT, photoId: 'ph_0123456789abcdef' }), {
      photo: PHOTO,
      foodText: 'сирники',
    });

    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'без сметани' } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.hasAttribute('capture')).toBe(false);
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));

    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    expect(estimate).toHaveBeenCalledWith(
      { date: TODAY, text: 'без сметани', image: { full: 'b64-1280', thumb: 'b64-320' } },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('img', { name: 'Фото їжі' }).getAttribute('src')).toBe('data:image/jpeg;base64,b64-320');
    fireEvent.click(screen.getByRole('button', { name: 'Додати 340 ккал' }));
    // A photo line never replaces typed text.
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 'ph_0123456789abcdef', kcal: 340, consumed: '' }),
    );
    // Focus goes back to «📷 Фото», where she started.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Порахувати калорії за фото' }));
  });

  it('a file that is not a photo is rejected without a request', async () => {
    const { estimate, notify } = setup(async () => RESULT);
    pickFile(new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Це не схоже на фото'));
    expect(screen.getByRole('alert').textContent).toBe('Це не схоже на фото');
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByText('Рахую калорії…')).toBeNull();
  });

  it('reports pending work to the sheet: own composer text, a request, a result not added yet', async () => {
    const answer = deferred<FoodEstimateResponse>();
    const { pending } = setup(() => answer.promise, { foodText: 'борщ' });
    expect(pending()).toBe(false);

    // The pre-filled tail is still in «Що я їла»: nothing to lose yet.
    fireEvent.click(toggle());
    expect(pending()).toBe(false);
    fireEvent.change(composer(), { target: { value: 'борщ 300 г' } });
    expect(pending()).toBe(true);

    fireEvent.click(submit());
    expect(pending()).toBe(true);
    await act(async () => answer.resolve(RESULT));
    expect(pending()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Додати 340 ккал' }));
    expect(pending()).toBe(false);
  });

  it('another day starts from scratch', async () => {
    const { rerender, pending } = setup(async () => RESULT);
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'борщ' } });
    fireEvent.click(submit());
    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    expect(pending()).toBe(true);

    rerender({ date: '2026-10-08', foodText: '' });
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Що порахувати' })).toBeNull();
    expect(pending()).toBe(false);
  });

  it('offline: buttons disabled with a hint; chips still work and are confirmed', () => {
    store.online = false;
    store.foods = [{ name: 'Сирники', portion: '3 шт', kcal: 450, count: 2, lastUsed: '2026-10-01' }];
    const { onAdd } = setup(async () => RESULT);
    expect(toggle().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Порахувати калорії за фото' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Потрібен інтернет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Додати «Сирники», 450 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        line: 'Сирники (3 шт) — 450 ккал',
        consumed: '',
        uses: [{ name: 'Сирники', portion: '3 шт', kcal: 450 }],
      }),
    );
    expect(store.commit).not.toHaveBeenCalled();
    expect(live().textContent).toBe('Додано «Сирники», 450 ккал');
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
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'стіл' } });
    fireEvent.click(submit());
    await screen.findByText('Це не схоже на їжу.');
    expect(live().textContent).toBe('Нічого не знайдено');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(composer().value).toBe('стіл');
    expect(document.activeElement).toBe(composer());
  });
});

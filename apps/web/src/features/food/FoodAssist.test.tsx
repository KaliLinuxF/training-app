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

    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії позиції 2' }), { target: { value: '160' } });
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

describe('FoodAssist: correcting the estimate', () => {
  const PLATE: FoodEstimateResponse = {
    photoId: 'ph_0123456789abcdef',
    items: [
      { name: 'Гречка', portion: '200 г', kcal: 220 },
      { name: 'Котлета куряча', portion: '1 шт', kcal: 180 },
      { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
    ],
    totalKcal: 445,
    comment: 'Порції приблизні.',
  };

  /** The server in recalculate mode: the sent items, same order, with new kcal. */
  const priced = (req: FoodEstimateRequest, kcal: number[]): FoodEstimateResponse => ({
    photoId: req.photoId ?? null,
    items: (req.items ?? []).map((it, i) => ({ name: it.name, portion: it.portion, kcal: kcal[i] ?? 0 })),
    totalKcal: kcal.reduce((a, b) => a + b, 0),
    comment: '',
  });

  const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
  const recalc = () => screen.getByRole('button', { name: /Перерахувати|Рахую…/ }) as HTMLButtonElement;
  const edit = (name: string, value: string) => fireEvent.change(textbox(name), { target: { value } });

  async function estimatePlate(estimate: EstimateFn) {
    const api = setup(estimate, { photo: PHOTO });
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: 'Оцінка калорій' });
    return api;
  }

  it('grams rescale at once; a renamed dish is recalculated with the photo for context; «Додати» uses her names', async () => {
    resetFoodStatus({ enabled: true, remainingToday: 5 });
    const { estimate, onAdd, pending } = await estimatePlate(async (req) =>
      req.items ? priced(req, [170, 310, 50]) : PLATE,
    );
    expect(screen.getByText('Сьогодні ще 4 підрахунки')).toBeTruthy();

    // Same dish, new grams: proportional kcal on the device, nothing sent.
    edit('Порція позиції 1', '150 г');
    expect(textbox('Калорії позиції 1').value).toBe('165');
    expect(screen.getByText('перераховано за вагою')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Перерахувати' })).toBeNull();

    // Another dish: marked, and the model is asked once she taps «Перерахувати».
    edit('Назва позиції 2', 'Котлета свиняча');
    edit('Порція позиції 2', '120 г');
    expect(screen.getByText('змінено')).toBeTruthy();
    expect(estimate).toHaveBeenCalledOnce();

    fireEvent.click(recalc());
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenLastCalledWith(
      {
        date: TODAY,
        items: [
          { name: 'Гречка', portion: '150 г' },
          { name: 'Котлета свиняча', portion: '120 г' },
          { name: 'Салат з огірків', portion: '100 г' },
        ],
        photoId: 'ph_0123456789abcdef',
      },
      expect.any(AbortSignal),
    );
    expect(recalc().textContent).toBe('Рахую…');
    expect(live().textContent).toBe('Рахую калорії…');
    expect(pending()).toBe(true);

    await waitFor(() => expect(textbox('Калорії позиції 2').value).toBe('310'));
    // Only the changed row takes the model's number.
    expect(textbox('Калорії позиції 1').value).toBe('165');
    expect(textbox('Калорії позиції 3').value).toBe('45');
    expect(screen.queryByText('змінено')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перерахувати' })).toBeNull();
    expect(live().textContent).toBe('Перераховано: разом 520 ккал');
    // It counted against today's budget.
    expect(screen.getByText('Сьогодні ще 3 підрахунки')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Додати 520 ккал' }));
    const items = [
      { name: 'Гречка', portion: '150 г', kcal: 165 },
      { name: 'Котлета свиняча', portion: '120 г', kcal: 310 },
      { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
    ];
    expect(onAdd).toHaveBeenCalledWith({
      line: 'Гречка (150 г), котлета свиняча (120 г), салат з огірків (100 г) — 520 ккал',
      consumed: '',
      kcal: 520,
      photoId: 'ph_0123456789abcdef',
      items,
      uses: items,
    });
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('a row she adds is priced too; a text estimate is recalculated without a photo', async () => {
    const { estimate } = setup(async (req) => (req.items ? priced(req, [260, 80, 25]) : RESULT));
    fireEvent.click(toggle());
    fireEvent.change(composer(), { target: { value: 'борщ і хліб' } });
    fireEvent.click(submit());
    await screen.findByRole('heading', { name: 'Оцінка калорій' });

    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(document.activeElement).toBe(textbox('Назва позиції 3'));
    edit('Назва позиції 3', 'Сметана');
    edit('Порція позиції 3', '1 ложка');
    fireEvent.click(recalc());
    expect(estimate).toHaveBeenLastCalledWith(
      {
        date: TODAY,
        items: [
          { name: 'Борщ', portion: '300 г' },
          { name: 'Хліб', portion: '1 скибка' },
          { name: 'Сметана', portion: '1 ложка' },
        ],
      },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(textbox('Калорії позиції 3').value).toBe('25'));
    expect(screen.getByRole('button', { name: 'Додати 365 ккал' })).toBeTruthy();
  });

  it('a failed recalculation keeps her rows, explains inline and in the toast', async () => {
    const { notify } = await estimatePlate(async (req) => {
      if (req.items) throw new ApiError(502, 'ai_failed', 'x');
      return PLATE;
    });
    edit('Назва позиції 2', 'Котлета свиняча');
    fireEvent.click(recalc());
    const message = 'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(textbox('Назва позиції 2').value).toBe('Котлета свиняча');
    expect(textbox('Калорії позиції 2').value).toBe('180');
    expect(screen.getByText('змінено')).toBeTruthy();
    // Ready for another try; «Додати» works with what is on screen.
    expect(recalc().textContent).toBe('✨ Перерахувати');
    expect(screen.getByRole('button', { name: 'Додати 445 ккал' })).toBeTruthy();
  });

  it('an answer for other items than she sent is not applied', async () => {
    const { notify } = await estimatePlate(async (req) =>
      req.items ? { ...priced(req, [1]), items: [{ name: 'Гречка', portion: '200 г', kcal: 1 }] } : PLATE,
    );
    edit('Назва позиції 2', 'Котлета свиняча');
    fireEvent.click(recalc());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Не вдалося порахувати — спробуй ще раз'));
    expect(textbox('Калорії позиції 1').value).toBe('220');
    expect(textbox('Калорії позиції 2').value).toBe('180');
  });

  it('the daily limit hit on recalculation locks «Перерахувати» under her focus; one line says why', async () => {
    const LIMIT = 'Ліміт підрахунків на сьогодні вичерпано';
    const { notify, estimate } = await estimatePlate(async (req) => {
      if (req.items) throw new ApiError(429, 'rate_limited', 'limit');
      return PLATE;
    });
    edit('Назва позиції 2', 'Котлета свиняча');
    recalc().focus();
    fireEvent.click(recalc());
    await waitFor(() => expect(notify).toHaveBeenCalledWith(LIMIT));

    // Locked, but never natively disabled: her focus stays on it instead of falling to <body>.
    expect(recalc().getAttribute('aria-disabled')).toBe('true');
    expect(recalc().disabled).toBe(false);
    expect(document.activeElement).toBe(recalc());
    fireEvent.click(recalc());
    expect(estimate).toHaveBeenCalledTimes(2);

    // One line in the sheet, like a 429 on the first estimate: the card's alert doubles as the
    // hint every locked button is described by.
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(LIMIT);
    expect(alert.id).not.toBe('');
    expect(recalc().getAttribute('aria-describedby')).toBe(alert.id);
    expect(screen.getByRole('button', { name: 'Порахувати калорії за фото' }).getAttribute('aria-describedby')).toBe(
      alert.id,
    );
    // «Додати» still adds what is on screen.
    expect(screen.getByRole('button', { name: 'Додати 445 ккал' }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('out of estimates after the first one: a single «Ліміт…» line, not one more in the card', async () => {
    resetFoodStatus({ enabled: true, remainingToday: 1 });
    await estimatePlate(async () => PLATE);
    edit('Назва позиції 2', 'Котлета свиняча');
    const line = screen.getByText('Ліміт підрахунків на сьогодні вичерпано');
    expect(screen.getAllByText('Ліміт підрахунків на сьогодні вичерпано')).toHaveLength(1);
    expect(recalc().getAttribute('aria-disabled')).toBe('true');
    expect(recalc().getAttribute('aria-describedby')).toBe(line.id);
  });

  it('offline: «Перерахувати» is locked and described by the hint', async () => {
    const { rerender } = await estimatePlate(async () => PLATE);
    edit('Назва позиції 2', 'Котлета свиняча');
    store.online = false;
    rerender({});
    expect(recalc().getAttribute('aria-disabled')).toBe('true');
    expect(recalc().getAttribute('aria-describedby')).toBe(screen.getByText('Потрібен інтернет').id);
  });

  it('going offline while «Рахую…» keeps her focus on the button when the request fails', async () => {
    const answer = deferred<FoodEstimateResponse>();
    const { rerender, estimate } = await estimatePlate((req) => (req.items ? answer.promise : Promise.resolve(PLATE)));
    edit('Назва позиції 2', 'Котлета свиняча');
    recalc().focus();
    fireEvent.click(recalc());
    store.online = false;
    rerender({});
    await act(async () => answer.reject(new ApiError(0, 'network', 'offline')));

    expect(screen.getByRole('alert').textContent).toBe('Немає зʼєднання з сервером');
    expect(recalc().textContent).toBe('✨ Перерахувати');
    expect(recalc().getAttribute('aria-disabled')).toBe('true');
    expect(recalc().disabled).toBe(false);
    expect(document.activeElement).toBe(recalc());
    fireEvent.click(recalc());
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('a failed recalculation announces nothing stale in the status region', async () => {
    let fail = false;
    await estimatePlate(async (req) => {
      if (!req.items) return PLATE;
      if (fail) throw new ApiError(502, 'ai_failed', 'x');
      return priced(req, [310, 50]);
    });
    expect(live().textContent).toBe('Знайдено 3 позиції, разом 445 ккал');
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати «Гречка»' }));
    edit('Назва позиції 1', 'Котлета свиняча');
    fireEvent.click(recalc());
    await waitFor(() => expect(live().textContent).toBe('Перераховано: разом 355 ккал'));

    // A second one fails: the card's alert says so; neither the first estimate («Знайдено 3…»,
    // out of date) nor the last total is read out again.
    fail = true;
    edit('Назва позиції 2', 'Салат з помідорів');
    fireEvent.click(recalc());
    expect(live().textContent).toBe('Рахую калорії…');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(live().textContent).toBe('');
  });

  it('«Додати» waits while «Рахую…», then adds her dish with the new kcal', async () => {
    const answer = deferred<FoodEstimateResponse>();
    let sent: FoodEstimateRequest | undefined;
    const { onAdd, estimate } = await estimatePlate(async (req) => {
      if (!req.items) return PLATE;
      sent = req;
      return answer.promise;
    });
    edit('Назва позиції 2', 'Котлета свиняча');
    fireEvent.click(recalc());

    const add = screen.getByRole('button', { name: 'Додати 445 ккал' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe(recalc().id);
    fireEvent.click(add);
    // Not the old dish's 180 kcal under her new name (nor in «Часті страви»), and the request she
    // asked for is not thrown away.
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Оцінка калорій' })).toBeTruthy();
    expect(estimate).toHaveBeenCalledTimes(2);

    await act(async () => answer.resolve(priced(sent as FoodEstimateRequest, [220, 310, 45])));
    fireEvent.click(screen.getByRole('button', { name: 'Додати 575 ккал' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        kcal: 575,
        uses: [
          { name: 'Гречка', portion: '200 г', kcal: 220 },
          { name: 'Котлета свиняча', portion: '1 шт', kcal: 310 },
          { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
        ],
      }),
    );
  });

  it('a photo cleaned up on the server meanwhile: priced again without it, and not added with the day', async () => {
    const gone = new ApiError(404, 'not_found', 'Фото не знайдено');
    const { estimate, notify, onAdd } = await estimatePlate(async (req) => {
      if (!req.items) return PLATE;
      if (req.photoId) throw gone;
      return priced(req, [220, 310, 45]);
    });
    edit('Назва позиції 2', 'Котлета свиняча');
    fireEvent.click(recalc());
    await waitFor(() => expect(textbox('Калорії позиції 2').value).toBe('310'));

    const items = [
      { name: 'Гречка', portion: '200 г' },
      { name: 'Котлета свиняча', portion: '1 шт' },
      { name: 'Салат з огірків', portion: '100 г' },
    ];
    expect(estimate.mock.calls.slice(1).map(([req]) => req)).toEqual([
      { date: TODAY, items, photoId: 'ph_0123456789abcdef' },
      { date: TODAY, items },
    ]);
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    // The next one does not ask about the photo again.
    edit('Назва позиції 3', 'Салат з помідорів');
    fireEvent.click(recalc());
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(4));
    expect(estimate.mock.lastCall?.[0].photoId).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Перерахувати|Рахую…/ })).toBeNull());

    // Its file is gone: the day must not point at it.
    fireEvent.click(screen.getByRole('button', { name: /^Додати \d+ ккал$/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ photoId: null }));
  });

  it('«Скасувати» while recalculating drops the request and the card', async () => {
    const answer = deferred<FoodEstimateResponse>();
    let signal: AbortSignal | undefined;
    const { onAdd, pending } = await estimatePlate(async (req, s) => {
      if (!req.items) return PLATE;
      signal = s;
      return answer.promise;
    });
    edit('Назва позиції 2', 'Котлета свиняча');
    fireEvent.click(recalc());
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(pending()).toBe(false);
    await act(async () => answer.resolve(PLATE));
    expect(screen.queryByRole('heading', { name: 'Оцінка калорій' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

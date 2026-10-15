import {
  emptyData,
  f0,
  LEGACY_MEAL_ID,
  normalizeDay,
  type AppData,
  type FoodEstimateRequest,
  type FoodEstimateResponse,
  type FoodItem,
  type Meal,
} from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type RefObject } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { deferred } from '@/store/test-utils';
import { ui } from '@/store/ui';
import { ConfirmHost, Sheet } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import type { EstimateDeps } from '../estimate';
import { UNDO_LABEL } from '../EstimateCard';
import { resetFoodStatus } from '../foodStatus';
import type { PhotoDeps } from '../image';
import { MealEditorBody } from './MealEditorBody';
import type { MealTarget } from './mealModel';
import { fakeStore } from './testStore';
import { useMealEditor, type MealEditor } from './useMealEditor';

vi.mock('@/store/data', async () => (await import('./testStore')).storeModule);
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { foodStatus: vi.fn(() => new Promise(() => undefined)), foodEstimate: vi.fn() },
}));

const TODAY = '2026-10-14';
const PAST = '2026-10-09';
const NB = '\u00A0';
const flat = (text: string): string => text.replace(/\u00A0/g, ' ');
const NO_MACROS = { protein: null, fat: null, carbs: null };
const photoId = (n: number): string => `photo${String(n).padStart(12, '0')}`;

const TOAST: FoodEstimateResponse = {
  photoId: null,
  items: [
    { name: 'Тост з тунцем', portion: '2 шт', kcal: 310, protein: 24, fat: 8, carbs: 31 },
    { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
  ],
  totalKcal: 370,
  comment: 'Порції приблизні.',
};
const APPLE: FoodEstimateResponse = {
  photoId: null,
  items: [{ name: 'Яблуко', portion: '1 шт', kcal: 80, protein: 0.5, fat: 0, carbs: 19 }],
  totalKcal: 80,
  comment: '',
};
const SYRNYKY: FoodEstimateResponse = {
  photoId: photoId(1),
  items: [{ name: 'Сирники зі сметаною', portion: '3 шт', kcal: 420, protein: 22, fat: 22, carbs: 33 }],
  totalKcal: 420,
  comment: 'Сметана — приблизно 2 ложки',
};

const PHOTO: PhotoDeps = {
  decode: async () => ({
    source: {} as CanvasImageSource,
    width: 4000,
    height: 3000,
    release: () => undefined,
  }),
  encode: async (_src, size) => ({ canvas: {} as CanvasImageSource, blob: new Blob([`${size.width}`]) }),
  toBase64: async (blob) => `b64-${await blob.text()}`,
};

type EstimateFn = (req: FoodEstimateRequest, signal?: AbortSignal) => Promise<FoodEstimateResponse>;

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: type,
  kcal,
  ...NO_MACROS,
  ...extra,
});

function dataWith(meals: Meal[], date = TODAY, foods: FoodItem[] = []): AppData {
  const data = emptyData();
  data.foods = foods;
  if (meals.length)
    data.days[date] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals });
  return data;
}

interface HostProps {
  target: MealTarget | null;
  deps: EstimateDeps;
  onShowDay?: () => void;
  onDeleted?: () => void;
  stacked?: boolean;
  editorRef?: RefObject<MealEditor | null>;
}

function Host({ target, deps, onShowDay, onDeleted, stacked, editorRef }: HostProps) {
  const editor = useMealEditor(target, { estimate: deps });
  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  });
  return (
    <>
      <Sheet open onClose={() => undefined} heading="Прийом їжі">
        <MealEditorBody editor={editor} onShowDay={onShowDay} onDeleted={onDeleted} stacked={stacked} />
      </Sheet>
      <ConfirmHost />
    </>
  );
}

interface SetupOptions {
  data?: AppData;
  target?: Partial<MealTarget>;
  photo?: boolean;
  onShowDay?: () => void;
  onDeleted?: () => void;
  stacked?: boolean;
}

function setup(estimate: EstimateFn = async () => TOAST, opts: SetupOptions = {}) {
  fakeStore.reset(opts.data ?? emptyData());
  const notify = vi.fn();
  const estimateMock = vi.fn(estimate);
  const deps: EstimateDeps = { estimate: estimateMock, notify, ...(opts.photo ? { photo: PHOTO } : {}) };
  const target: MealTarget = { date: TODAY, mealId: null, key: 1, ...opts.target };
  const editorRef: RefObject<MealEditor | null> = { current: null };
  const view = render(
    <Host
      target={target}
      deps={deps}
      onShowDay={opts.onShowDay}
      onDeleted={opts.onDeleted}
      stacked={opts.stacked}
      editorRef={editorRef}
    />,
  );
  return { estimate: estimateMock, notify, editor: () => editorRef.current, view };
}

const sheet = () => screen.getByRole('dialog', { name: 'Прийом їжі' });
const text = () => screen.getByRole('textbox', { name: 'Що я їла' }) as HTMLTextAreaElement;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const countButton = () => button(/^(Порахувати калорії$|Порахувати решту: |Додати ще: )/);
const photoButton = () => button('Порахувати калорії за фото');
const live = () => within(sheet()).getAllByRole('status').at(-1) as HTMLElement;
const card = () => screen.getByRole('region', { name: 'Позиції' });
const rowLabels = () =>
  within(card())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('button')?.getAttribute('aria-label'));
const typeChip = (name: string) =>
  within(screen.getByRole('group', { name: 'Тип прийому їжі' })).getByRole('button', {
    name,
  }) as HTMLButtonElement;
const pickFile = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
/** Taps a button the way a finger does: it takes focus first. */
function tap(el: HTMLElement) {
  el.focus();
  fireEvent.click(el);
}
const typeText = (value: string) => fireEvent.change(text(), { target: { value } });

/** WCAG 2.5.3: each button's accessible name contains the words it shows (symbols and aria-hidden parts aside). */
function expectLabelsInNames(buttons: readonly HTMLElement[]) {
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) {
    const visible = Array.from(b.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
      .map((n) => n.textContent)
      .join('')
      .replace(/[+✓✕›→]/g, '')
      .trim()
      .toLocaleLowerCase('uk');
    const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').toLocaleLowerCase('uk');
    if (visible) expect(name, `«${b.textContent}»`).toContain(visible);
  }
}
const itemEditor = () => screen.getByRole('dialog', { name: /^(Позиція|Нова позиція)$/ });

beforeAll(() => {
  installMatchMedia();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 10, 0));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  stubScrollTo();
  resetFoodStatus({ enabled: true, remainingToday: 42 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MealEditorBody: the layout', () => {
  it('a new meal: type preselected by the time, «Що я їла» focused on open; the AI row comes before it', () => {
    setup();
    expect(typeChip('Сніданок').getAttribute('aria-pressed')).toBe('true');
    expect(typeChip('Обід').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(text());
    expect(text().getAttribute('placeholder')).toBe('Напр.: тост з тунцем, кава');
    expect(text().getAttribute('maxlength')).toBe('5000');
    expect(text().getAttribute('rows')).toBe('2');
    // Above the text, so the iPhone keyboard never covers them.
    for (const b of [countButton(), photoButton()]) {
      expect(b.compareDocumentPosition(text()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const chips = screen.getByRole('group', { name: 'Тип прийому їжі' });
    expect(chips.compareDocumentPosition(countButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Timed now; the time row is at the bottom.
    expect((screen.getByLabelText('Час') as HTMLInputElement).value).toBe('10:00');
  });

  it('an existing meal opens without the keyboard', () => {
    setup(undefined, { data: dataWith([meal('lunch', 'Обід', 500)]), target: { mealId: 'lunch' } });
    expect(text().value).toBe('Обід');
    expect(document.activeElement).not.toBe(text());
    expect(typeChip('Обід').getAttribute('aria-pressed')).toBe('true');
  });

  it('no macro inputs on a new meal until «+ Б · Ж · В»; it opens them with «Білки» focused', () => {
    setup();
    expect(screen.queryByRole('textbox', { name: 'Білки' })).toBeNull();
    const kcal = screen.getByRole('textbox', { name: 'Калорії' }) as HTMLInputElement;
    expect(kcal.getAttribute('inputmode')).toBe('numeric');
    tap(button(/^\+ Б · Ж · В/));
    const protein = screen.getByRole('textbox', { name: 'Білки' });
    expect(document.activeElement).toBe(protein);
    expect(protein.getAttribute('inputmode')).toBe('decimal');
    expect(screen.getByRole('textbox', { name: 'Жири' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Вуглеводи' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^\+ Б · Ж · В/ })).toBeNull();
  });

  it('a meal with a typed macro opens with the inputs', () => {
    setup(undefined, {
      data: dataWith([meal('s', 'Перекус', 80, { protein: 0.5 })]),
      target: { mealId: 's' },
    });
    expect((screen.getByRole('textbox', { name: 'Білки' }) as HTMLInputElement).value).toBe('0,5');
  });

  it('accessible names contain their visible label (WCAG 2.5.3); no control inside another', () => {
    setup(undefined, {
      data: dataWith([meal('lunch', 'Обід', 500), meal('b', 'Сніданок', 300)]),
      target: { mealId: 'lunch' },
      onShowDay: () => undefined,
    });
    expectLabelsInNames(within(sheet()).getAllByRole('button'));
    // «Усі прийоми за день →» is named by what it says.
    const all = button('Усі прийоми за день →');
    expect(all.hasAttribute('aria-label')).toBe(false);
    expect(
      sheet().querySelectorAll('button button, button input, button a, a button, label button'),
    ).toHaveLength(0);
  });

  it('after an estimate too: «Прибрати ці позиції» and the AI row are named by what they show (WCAG 2.5.3)', async () => {
    setup();
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    const undo = button(UNDO_LABEL);
    expect(undo.textContent).toBe('Прибрати ці позиції');
    // The rows of the card are named by their whole line (EstimateCard.test checks them).
    expectLabelsInNames(
      within(sheet())
        .getAllByRole('button')
        .filter((b) => !b.closest('li')),
    );
  });

  it('stacked over another sheet, a day other than today says which: «9 жовтня · пʼятниця»', () => {
    const { view } = setup(undefined, { target: { date: PAST }, stacked: true });
    expect(screen.getByText('9 жовтня · пʼятниця')).toBeTruthy();
    view.unmount();
    setup(undefined, { stacked: true });
    expect(screen.queryByText(/жовтня ·/)).toBeNull();
    cleanup();
    // Hosted with its own date nav (not stacked): never.
    setup(undefined, { target: { date: PAST } });
    expect(screen.queryByText(/жовтня ·/)).toBeNull();
  });

  it('the legacy block asks for a type', () => {
    const data = emptyData();
    data.days[TODAY] = { food: 'Борщ, хліб', kcal: 500, trained: null, types: [], notes: '' };
    setup(undefined, { data, target: { mealId: LEGACY_MEAL_ID } });
    expect(
      screen.getByText('Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Тип прийому їжі' })).queryByRole('button', { pressed: true }),
    ).toBeNull();
    fireEvent.click(typeChip('Обід'));
    expect(screen.queryByText(/Це запис зі старої версії/)).toBeNull();
  });
});

describe('MealEditorBody: type', () => {
  it('a past meal’s label she has renamed since stays a chip after she taps another one', () => {
    const data = dataWith([meal('b', 'Сніданок', 300)]);
    data.settings.mealTypes = ['Ранок', 'Обід', 'Вечеря', 'Перекус'];
    setup(undefined, { data, target: { mealId: 'b' } });
    expect(typeChip('Сніданок').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(typeChip('Обід'));
    expect(typeChip('Обід').getAttribute('aria-pressed')).toBe('true');
    expect(typeChip('Сніданок').getAttribute('aria-pressed')).toBe('false');
    const group = screen.getByRole('group', { name: 'Тип прийому їжі' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Ранок', 'Обід', 'Вечеря', 'Перекус', 'Сніданок']);
    fireEvent.click(typeChip('Сніданок'));
    expect(typeChip('Сніданок').getAttribute('aria-pressed')).toBe('true');
  });

  it('one selected chip; tapping it again keeps it', () => {
    const { editor } = setup();
    fireEvent.click(typeChip('Перекус'));
    expect(typeChip('Перекус').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(typeChip('Перекус'));
    expect(typeChip('Перекус').getAttribute('aria-pressed')).toBe('true');
    expect(editor()?.session?.draft.type).toBe('Перекус');
  });

  it('«+ Свій» adds her type to the list at once and selects it; Escape cancels without closing', async () => {
    setup();
    const add = button('Додати свій тип прийому їжі');
    expect(add.textContent).toBe('+ Свій');
    tap(add);
    const input = screen.getByRole('textbox', { name: 'Новий тип прийому їжі' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('placeholder')).toBe('Назва');
    expect(input.getAttribute('maxlength')).toBe('30');
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(screen.queryByRole('textbox', { name: 'Новий тип прийому їжі' })).toBeNull();
    expect(sheet()).toBeTruthy();
    expect(document.activeElement).toBe(add);

    tap(add);
    fireEvent.change(screen.getByRole('textbox', { name: 'Новий тип прийому їжі' }), {
      target: { value: 'Після тренування' },
    });
    fireEvent.click(button('Додати тип'));
    expect(fakeStore.data.settings.mealTypes).toEqual([
      'Сніданок',
      'Обід',
      'Вечеря',
      'Перекус',
      'Після тренування',
    ]);
    expect(typeChip('Після тренування').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(typeChip('Після тренування'));
  });

  it('at 12 types the name is for this meal only, and a status line says so', () => {
    const data = emptyData();
    data.settings.mealTypes = Array.from({ length: 12 }, (_, i) => `Тип ${i + 1}`);
    setup(undefined, { data });
    tap(button('Додати свій тип прийому їжі'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Новий тип прийому їжі' }), {
      target: { value: 'Пізній' },
    });
    fireEvent.click(button('Додати тип'));
    expect(fakeStore.data.settings.mealTypes).toHaveLength(12);
    expect(typeChip('Пізній').getAttribute('aria-pressed')).toBe('true');
    const notes = within(sheet())
      .getAllByRole('status')
      .map((s) => s.textContent);
    expect(notes).toContain('У списку вже 12 типів — ця назва лише для цього прийому');
  });
});

describe('MealEditorBody: estimates', () => {
  it('«✨ Порахувати» with nothing written leads to the text, no request', () => {
    const { estimate } = setup();
    const count = countButton();
    expect(count.getAttribute('aria-disabled')).toBe('true');
    tap(count);
    expect(estimate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(text());
  });

  it('counts the text: progress, then positions with Б · Ж · В, announced, focus on «Позиції»', async () => {
    const answer = deferred<FoodEstimateResponse>();
    const { estimate } = setup(() => answer.promise);
    typeText('тост з тунцем, кава');
    tap(countButton());
    expect(estimate).toHaveBeenCalledWith(
      { date: TODAY, text: 'тост з тунцем, кава' },
      expect.any(AbortSignal),
    );
    expect(live().textContent).toBe('Рахую калорії…');
    expect(document.activeElement).toBe(button('Скасувати'));
    expect(button('Порахувати калорії').getAttribute('aria-disabled')).toBe('true');

    await act(async () => answer.resolve(TOAST));
    expect(rowLabels()).toEqual([
      'Тост з тунцем, 2 шт, 310 ккал, білки 24, жири 8, вуглеводи 31 г. Змінити',
      'Кава з молоком, 1 чашка, 60 ккал, білки 3, жири 3, вуглеводи 5 г. Змінити',
    ]);
    expect(within(card()).getByText('Разом').parentElement?.textContent).toBe('Разом370 ккал');
    expect(within(card()).getByText(flat(`Б${NB}27${NB}· Ж${NB}11${NB}· В${NB}36${NB}г`))).toBeTruthy();
    expect(screen.getByText('Порції приблизні.')).toBeTruthy();
    expect(live().textContent).toBe('Знайдено 2 позиції, разом 370 ккал');
    expect(document.activeElement).toBe(within(card()).getByText('Позиції'));
    // Positions replace the manual numbers; the first button now adds more.
    expect(screen.queryByRole('textbox', { name: 'Калорії' })).toBeNull();
    expect(countButton().getAttribute('aria-label')).toBe('Додати ще: порахувати калорії');
    expect(screen.getByText(flat(`За день: ${f0(370)} / ${f0(1700)} ккал`))).toBeTruthy();
  });

  it('what she writes after the counted text is «Ще не пораховано»; «Порахувати решту» counts only that', async () => {
    let n = 0;
    const { estimate } = setup(async () => (++n === 1 ? TOAST : APPLE));
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    typeText('тост з тунцем, кава, яблуко');
    expect(screen.getByText('Ще не пораховано: яблуко')).toBeTruthy();
    const rest = countButton();
    expect(rest.getAttribute('aria-label')).toBe('Порахувати решту: яблуко');
    expect(rest.textContent).toBe('✨ Порахувати решту');
    tap(rest);
    expect(estimate).toHaveBeenLastCalledWith({ date: TODAY, text: 'яблуко' }, expect.any(AbortSignal));
    await waitFor(() => expect(rowLabels()).toHaveLength(3));
    expect(rowLabels()[2]).toBe('Яблуко, 1 шт, 80 ккал, білки 1, жири 0, вуглеводи 19 г. Змінити');
    expect(screen.queryByText(/Ще не пораховано/)).toBeNull();
    expect(live().textContent).toBe('Знайдено 1 позицію, разом 80 ккал');
  });

  it('«✨ Додати ще» opens «Що ще порахувати?» and appends what it finds', async () => {
    let n = 0;
    const { estimate } = setup(async () => (++n === 1 ? TOAST : APPLE));
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    tap(countButton());
    const composer = screen.getByRole('textbox', { name: 'Що ще порахувати?' });
    expect(document.activeElement).toBe(composer);
    fireEvent.change(composer, { target: { value: 'яблуко' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(estimate).toHaveBeenLastCalledWith({ date: TODAY, text: 'яблуко' }, expect.any(AbortSignal));
    await waitFor(() => expect(rowLabels()).toHaveLength(3));
    expect(screen.queryByRole('textbox', { name: 'Що ще порахувати?' })).toBeNull();
    // The meal text is hers, untouched.
    expect(text().value).toBe('тост з тунцем, кава');
  });

  it('«Прибрати ці позиції» takes back that estimate’s rows and photo, says so, focus to the AI row', async () => {
    const { estimate } = setup(async () => SYRNYKY, { photo: true });
    typeText('сирники');
    tap(photoButton());
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('region', { name: 'Позиції' });
    // Sent with the text as a hint; the photo joins the meal.
    expect(estimate).toHaveBeenCalledWith(
      { date: TODAY, text: 'сирники', image: { full: 'b64-1280', thumb: 'b64-320' } },
      expect.any(AbortSignal),
    );
    expect(screen.getAllByRole('img', { name: 'Фото їжі' })).toHaveLength(1);
    expect(document.activeElement).toBe(within(card()).getByText('Позиції'));
    tap(button(UNDO_LABEL));
    expect(screen.queryByRole('region', { name: 'Позиції' })).toBeNull();
    expect(screen.queryAllByRole('img', { name: 'Фото їжі' })).toHaveLength(0);
    expect(live().textContent).toBe('Позиції прибрано');
    expect(document.activeElement).toBe(countButton());
    // Back to her own numbers.
    expect(screen.getByRole('textbox', { name: 'Калорії' })).toBeTruthy();
  });

  it('an old «Їжа за день» block with kcal: «✨ Порахувати» replaces her number (no «Інше»); the undo restores it', async () => {
    const data = emptyData();
    data.days[TODAY] = { food: 'тост з тунцем, кава', kcal: 900, trained: null, types: [], notes: '' };
    const { estimate } = setup(undefined, { data, target: { mealId: LEGACY_MEAL_ID } });
    const kcal = () => screen.queryByRole('textbox', { name: 'Калорії' }) as HTMLInputElement | null;
    expect(kcal()?.value).toBe('900');
    expect(screen.getByText(flat(`За день: ${f0(900)} / ${f0(1700)} ккал`))).toBeTruthy();
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    expect(estimate).toHaveBeenCalledWith(
      { date: TODAY, text: 'тост з тунцем, кава' },
      expect.any(AbortSignal),
    );
    expect(rowLabels().map((l) => l?.split(',')[0])).toEqual(['Тост з тунцем', 'Кава з молоком']);
    expect(kcal()).toBeNull();
    // The day counts the estimate alone.
    expect(screen.getByText(flat(`За день: ${f0(370)} / ${f0(1700)} ккал`))).toBeTruthy();
    tap(button(UNDO_LABEL));
    expect(kcal()?.value).toBe('900');
    expect(screen.getByText(flat(`За день: ${f0(900)} / ${f0(1700)} ккал`))).toBeTruthy();
  });

  it('the undo goes once one of those rows is edited', async () => {
    setup();
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    expect(button(UNDO_LABEL)).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: /^Тост з тунцем, / }));
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Збільшити' }));
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('button', { name: UNDO_LABEL })).toBeNull();
    // Rescaled on the device, macros too: 3 тости.
    expect(rowLabels()[0]).toBe('Тост з тунцем, 3 шт, 465 ккал, білки 36, жири 12, вуглеводи 47 г. Змінити');
  });

  it('a photo is estimated with the composer text as a hint; past the day’s 12 it is not attached', async () => {
    const many = Array.from({ length: 12 }, (_, i) => photoId(20 + i));
    const { estimate } = setup(async () => SYRNYKY, {
      photo: true,
      data: dataWith([meal('lunch', 'Обід', 500, { photos: many })]),
    });
    // The day is full: «📷 Фото» says why.
    expect(photoButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Не більше 12 фото на день')).toBeTruthy();
    tap(photoButton());
    expect(estimate).not.toHaveBeenCalled();
  });

  it('focus is left alone when she is writing by the time the answer arrives', async () => {
    const answer = deferred<FoodEstimateResponse>();
    setup(() => answer.promise);
    typeText('тост з тунцем');
    tap(countButton());
    text().focus();
    await act(async () => answer.resolve(TOAST));
    expect(screen.getByRole('region', { name: 'Позиції' })).toBeTruthy();
    expect(document.activeElement).toBe(text());
  });

  it('a photo with the composer open: its text is the hint, and «Що я їла» is not marked as counted', async () => {
    let n = 0;
    const { estimate } = setup(async () => (++n === 1 ? TOAST : SYRNYKY), { photo: true });
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    tap(countButton());
    fireEvent.change(screen.getByRole('textbox', { name: 'Що ще порахувати?' }), {
      target: { value: 'без сметани' },
    });
    tap(photoButton());
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(rowLabels()).toHaveLength(3));
    expect(estimate).toHaveBeenLastCalledWith(
      { date: TODAY, text: 'без сметани', image: { full: 'b64-1280', thumb: 'b64-320' } },
      expect.any(AbortSignal),
    );
    // The photo was the third thing she had, not her text: «Ще не пораховано» still follows the text.
    typeText('тост з тунцем, кава, сирники');
    expect(screen.getByText('Ще не пораховано: сирники')).toBeTruthy();
  });

  it('a failed photo estimate suggests describing it; a file that is not a photo is refused on the device', async () => {
    let fail = true;
    const { estimate, notify } = setup(
      async () => {
        if (fail) throw new ApiError(502, 'ai_failed', 'x');
        return SYRNYKY;
      },
      { photo: true },
    );
    tap(photoButton());
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    const advice = 'Не вдалося розпізнати — спробуй описати текстом';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(advice));
    expect(screen.getByRole('alert').textContent).toBe(advice);
    expect(document.activeElement).toBe(photoButton());
    fail = false;
    estimate.mockClear();
    pickFile(new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Це не схоже на фото'));
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByText('Рахую калорії…')).toBeNull();
  });

  it('«Скасувати» while counting drops the request; a late answer changes nothing', async () => {
    const answer = deferred<FoodEstimateResponse>();
    let signal: AbortSignal | undefined;
    setup((_req, s) => {
      signal = s;
      return answer.promise;
    });
    typeText('піца');
    tap(countButton());
    tap(button('Скасувати'));
    expect(signal?.aborted).toBe(true);
    await act(async () => answer.resolve(TOAST));
    expect(screen.queryByRole('region', { name: 'Позиції' })).toBeNull();
    expect(text().value).toBe('піца');
    expect(document.activeElement).toBe(countButton());
  });

  it('a failure: advice inline and in the toast; the text stays', async () => {
    const { notify } = setup(async () => {
      throw new ApiError(502, 'ai_failed', 'x');
    });
    typeText('щось дивне');
    tap(countButton());
    const message = 'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(message));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(text().value).toBe('щось дивне');
  });

  it('the daily limit hit: both buttons locked, one line says why', async () => {
    const { notify } = setup(async () => {
      throw new ApiError(429, 'rate_limited', 'limit');
    });
    typeText('борщ');
    tap(countButton());
    const limit = 'Ліміт підрахунків на сьогодні вичерпано';
    await waitFor(() => expect(notify).toHaveBeenCalledWith(limit));
    expect(screen.getAllByText(limit)).toHaveLength(1);
    const line = screen.getByText(limit);
    expect(photoButton().getAttribute('aria-describedby')).toBe(line.id);
    expect(countButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('offline: the AI row says «Потрібен інтернет»; «Часті страви» still add positions', () => {
    const data = emptyData();
    data.foods = [
      {
        name: 'Сирники',
        portion: '3 шт',
        kcal: 450,
        count: 2,
        lastUsed: '2026-10-01',
        protein: 24,
        fat: 21,
        carbs: 39,
      },
    ];
    setup(undefined, { data });
    act(() => fakeStore.setOnline(false));
    expect(screen.getByText('Потрібен інтернет')).toBeTruthy();
    expect(photoButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button('Додати «Сирники», 450 ккал'));
    expect(rowLabels()).toEqual(['Сирники, 3 шт, 450 ккал, білки 24, жири 21, вуглеводи 39 г. Змінити']);
    expect(live().textContent).toBe('Додано «Сирники», 450 ккал');
  });

  it('no AI on the server: no AI row, the rest works', () => {
    resetFoodStatus({ enabled: false, remainingToday: 0 });
    setup();
    expect(screen.queryByRole('button', { name: 'Порахувати калорії' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Порахувати калорії за фото' })).toBeNull();
    expect(text()).toBeTruthy();
  });

  it('no AI: a renamed dish cannot be priced by the model, and the card says why', () => {
    resetFoodStatus({ enabled: false, remainingToday: 0 });
    const data = emptyData();
    data.foods = [{ name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 4, lastUsed: '2026-10-10' }];
    setup(undefined, { data });
    fireEvent.click(button('Додати «Кава з молоком», 60 ккал'));
    fireEvent.click(within(card()).getByRole('button', { name: /^Кава з молоком, / }));
    fireEvent.change(within(itemEditor()).getByRole('textbox', { name: 'Що це' }), {
      target: { value: 'Чай' },
    });
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Готово' }));
    const recalc = within(card()).getByRole('button', { name: 'Перерахувати' });
    expect(recalc.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(recalc.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Підрахунок зараз недоступний',
    );
  });

  it('30 positions: no more estimates or dishes, and the reason', async () => {
    const thirty: FoodEstimateResponse = {
      photoId: null,
      items: Array.from({ length: 30 }, (_, i) => ({
        name: `Страва ${i + 1}`,
        portion: '',
        kcal: 10,
        ...NO_MACROS,
      })),
      totalKcal: 300,
      comment: '',
    };
    setup(async () => thirty);
    typeText('багато всього');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    expect(countButton().getAttribute('aria-disabled')).toBe('true');
    expect(photoButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Не більше 30 позицій').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '+ позиція' })).toBeNull();
  });
});

describe('MealEditorBody: recalculation', () => {
  /** The server in recalculate mode: the sent items, same order, with new kcal and macros. */
  const priced = (req: FoodEstimateRequest, kcal: number[]): FoodEstimateResponse => ({
    photoId: req.photoId ?? null,
    items: (req.items ?? []).map((it, i) => ({
      name: it.name,
      portion: it.portion,
      kcal: kcal[i] ?? 0,
      protein: 10,
      fat: 5,
      carbs: 20,
    })),
    totalKcal: 0,
    comment: '',
  });

  it('a renamed position is «змінено»; «✨ Перерахувати» sends every row with the photo and takes kcal + macros', async () => {
    const { estimate } = setup(async (req) => (req.items ? priced(req, [330]) : SYRNYKY), { photo: true });
    tap(photoButton());
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('region', { name: 'Позиції' });
    fireEvent.click(within(card()).getByRole('button', { name: /^Сирники зі сметаною, / }));
    fireEvent.change(within(itemEditor()).getByRole('textbox', { name: 'Що це' }), {
      target: { value: 'Деруни' },
    });
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Готово' }));
    expect(rowLabels()[0]).toBe(
      'Деруни, 3 шт, 420 ккал, білки 22, жири 22, вуглеводи 33 г, змінено. Змінити',
    );
    tap(within(card()).getByRole('button', { name: 'Перерахувати' }));
    expect(estimate).toHaveBeenLastCalledWith(
      { date: TODAY, items: [{ name: 'Деруни', portion: '3 шт' }], photoId: photoId(1) },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(rowLabels()[0]).toBe('Деруни, 3 шт, 330 ккал, білки 10, жири 5, вуглеводи 20 г. Змінити'),
    );
    expect(live().textContent).toBe('Перераховано: разом 330 ккал');
  });

  it('an answer for other items than she sent is not applied', async () => {
    const { notify } = setup(async (req) =>
      req.items ? { ...priced(req, [1]), items: priced(req, [1]).items.slice(0, 1) } : TOAST,
    );
    typeText('тост з тунцем, кава');
    tap(countButton());
    await screen.findByRole('region', { name: 'Позиції' });
    fireEvent.click(within(card()).getByRole('button', { name: /^Кава з молоком, / }));
    fireEvent.change(within(itemEditor()).getByRole('textbox', { name: 'Що це' }), {
      target: { value: 'Чай' },
    });
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Готово' }));
    // Two rows sent, one priced: something is off — nothing is taken.
    tap(within(card()).getByRole('button', { name: 'Перерахувати' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Не вдалося порахувати — спробуй ще раз'));
    expect(rowLabels()[1]).toMatch(/^Чай, 1 чашка, 60 ккал, .*змінено\. Змінити$/);
    expect(rowLabels()[0]).toMatch(/^Тост з тунцем, 2 шт, 310 ккал/);
  });

  it('a photo gone from the server: priced again without it, and the meal no longer points at it', async () => {
    const gone = new ApiError(404, 'not_found', 'Фото не знайдено');
    const { estimate } = setup(
      async (req) => {
        if (!req.items) return SYRNYKY;
        if (req.photoId) throw gone;
        return priced(req, [330]);
      },
      { photo: true },
    );
    tap(photoButton());
    pickFile(new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('region', { name: 'Позиції' });
    fireEvent.click(within(card()).getByRole('button', { name: /^Сирники зі сметаною, / }));
    fireEvent.change(within(itemEditor()).getByRole('textbox', { name: 'Що це' }), {
      target: { value: 'Деруни' },
    });
    fireEvent.click(within(itemEditor()).getByRole('button', { name: 'Готово' }));
    tap(within(card()).getByRole('button', { name: 'Перерахувати' }));
    await waitFor(() => expect(rowLabels()[0]).toMatch(/^Деруни, 3 шт, 330 ккал/));
    expect(estimate.mock.calls.slice(1).map(([req]) => req.photoId)).toEqual([photoId(1), undefined]);
    expect(screen.queryAllByRole('img', { name: 'Фото їжі' })).toHaveLength(0);
  });
});

describe('MealEditorBody: by hand and the day', () => {
  it('a «Часті страви» chip on a meal priced by hand: her numbers become «Інше»', () => {
    const data = emptyData();
    data.foods = [
      {
        name: 'Кава з молоком',
        portion: '1 чашка',
        kcal: 60,
        count: 4,
        lastUsed: '2026-10-10',
        protein: 3,
        fat: 3,
        carbs: 5,
      },
    ];
    setup(undefined, { data });
    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії' }), { target: { value: '300' } });
    fireEvent.click(button('Додати «Кава з молоком», 60 ккал'));
    expect(rowLabels()).toEqual([
      'Інше, 300 ккал, вписано вручну. Змінити',
      'Кава з молоком, 1 чашка, 60 ккал, білки 3, жири 3, вуглеводи 5 г. Змінити',
    ]);
  });

  it('«За день» counts the other meals and this draft; over the goal it is lavender', () => {
    setup(undefined, { data: dataWith([meal('lunch', 'Обід', 1500)]), onShowDay: () => undefined });
    expect(screen.getByText(flat(`За день: ${f0(1500)} / ${f0(1700)} ккал`))).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії' }), { target: { value: '300' } });
    const line = screen.getByText(flat(`За день: ${f0(1800)} / ${f0(1700)} ккал`));
    expect(line.className).toMatch(/over/);
    expect(button('Усі прийоми за день →')).toBeTruthy();
  });

  it('«Усі прийоми за день →» only for a host that can show the day, on a day with other meals', () => {
    const onShowDay = vi.fn();
    const { view } = setup(undefined, { onShowDay });
    expect(screen.queryByRole('button', { name: 'Усі прийоми за день →' })).toBeNull();
    view.unmount();
    setup(undefined, { data: dataWith([meal('lunch', 'Обід', 500)]), onShowDay });
    fireEvent.click(button('Усі прийоми за день →'));
    expect(onShowDay).toHaveBeenCalledOnce();
    cleanup();
    setup(undefined, { data: dataWith([meal('lunch', 'Обід', 500)]) });
    expect(screen.queryByRole('button', { name: 'Усі прийоми за день →' })).toBeNull();
  });

  it('the time: ✕ takes it away, «+ Час» brings back the current one', () => {
    const { editor } = setup(undefined, { target: { date: PAST } });
    // Another day: no time to start with.
    tap(button('+ Час'));
    expect((screen.getByLabelText('Час') as HTMLInputElement).value).toBe('10:00');
    expect(document.activeElement).toBe(screen.getByLabelText('Час'));
    fireEvent.change(screen.getByLabelText('Час'), { target: { value: '08:30' } });
    expect(editor()?.session?.draft.time).toBe('08:30');
    tap(button('Прибрати час'));
    expect(screen.queryByLabelText('Час')).toBeNull();
    expect(document.activeElement).toBe(button('+ Час'));
  });

  it('«Видалити прийом» on an existing meal asks first, then deletes it', async () => {
    const onDeleted = vi.fn();
    const confirm = vi.spyOn(ui, 'confirm');
    setup(undefined, {
      data: dataWith([meal('lunch', 'Обід', 560)]),
      target: { mealId: 'lunch' },
      onDeleted,
    });
    // The item editor's «Видалити позицію» pattern: full width, outlined, under a divider.
    const del = button('Видалити прийом');
    expect(del.className).toMatch(/outline/);
    expect(del.className).toMatch(/full/);
    expect(del.parentElement?.className).toMatch(/danger/);
    fireEvent.click(del);
    expect(confirm).toHaveBeenCalledWith({
      title: 'Видалити прийом їжі?',
      body: 'Обід · 560 ккал',
      confirmLabel: 'Видалити',
      cancelLabel: 'Залишити',
      destructive: true,
    });
    const ask = await screen.findByRole('alertdialog', { name: 'Видалити прийом їжі?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fakeStore.data.days[TODAY]).toBeUndefined();
  });

  it('a new meal has nothing to delete', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Видалити прийом' })).toBeNull();
  });
});

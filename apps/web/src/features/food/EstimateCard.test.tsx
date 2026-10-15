import type { FoodEstimateItem, FoodItem } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createRef,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
  type RefObject,
} from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmHost, Sheet } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { emptyDraft, toDrafts, type DraftItem } from './drafts';
import {
  EstimateCard,
  EstimateLoading,
  rowDetail,
  rowLabel,
  UNDO_LABEL,
  type EstimateCardProps,
} from './EstimateCard';
import { estimateReducer, initialPositions, type EstimateAction, type PositionsState } from './estimate';

vi.mock('@/store/data', () => ({ useAppData: () => ({ foods: [] }) }));

beforeAll(() => installMatchMedia());
beforeEach(() => {
  stubScrollTo();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** U+00A0 inside «Б 6» and before « ·». */
const NB = '\u00A0';
/** `getByText` compares with the node text whitespace-normalised (no-break spaces become spaces), not the matcher. */
const flat = (text: string): string => text.replace(/\u00A0/g, ' ');

const ITEMS: FoodEstimateItem[] = [
  { name: 'Борщ', portion: '300 г', kcal: 260, protein: 6, fat: 12, carbs: 25 },
  { name: 'Хліб житній', portion: '2 скибки', kcal: 160, protein: 5, fat: 1, carbs: 30 },
  { name: 'Сметана', portion: '', kcal: 60, protein: 1, fat: 6, carbs: 1 },
];

const FOODS: FoodItem[] = [
  {
    name: 'Сирники',
    portion: '3 шт',
    kcal: 450,
    count: 5,
    lastUsed: '2026-10-01',
    protein: 24,
    fat: 21,
    carbs: 39,
  },
  { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 9, lastUsed: '2026-10-08' },
  { name: 'Сир кисломолочний', portion: '200 г', kcal: 240, count: 2, lastUsed: '2026-10-02' },
];

function positionsOf(items: FoodEstimateItem[] = ITEMS): PositionsState {
  return { ...initialPositions(toDrafts(items)), comment: 'Порції оцінені приблизно.' };
}

type HarnessProps = Partial<
  Pick<
    EstimateCardProps,
    'remaining' | 'recalculating' | 'recalcError' | 'recalcInEditor' | 'blockedHint' | 'foods'
  >
> & {
  onRecalculate?: () => void;
  items?: FoodEstimateItem[];
  /** Offer «Прибрати ці позиції» for the rows of estimate `e1` (all of them here). */
  undoable?: boolean;
  /** Lets a test feed the reducer what the hook would (a recalculation and its answer). */
  dispatchRef?: RefObject<Dispatch<EstimateAction> | null>;
};

/** Card wired to the positions reducer, as the meal editor does. */
function Harness({
  onRecalculate = () => undefined,
  items,
  remaining = 40,
  blockedHint,
  foods = FOODS,
  dispatchRef,
  recalculating,
  undoable = false,
  ...rest
}: HarnessProps) {
  const [state, dispatch] = useReducer(estimateReducer, items, (it) => {
    const p = positionsOf(it);
    return undoable
      ? {
          ...p,
          drafts: p.drafts.map((d) => ({ ...d, estimateId: 'e1' })),
          undo: { estimateId: 'e1', photoId: null },
        }
      : p;
  });
  const rowSeq = useRef(0);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dispatchRef) dispatchRef.current = dispatch;
  }, [dispatchRef]);
  return (
    <>
      <button ref={fallbackRef} type="button">
        Порахувати
      </button>
      <EstimateCard
        drafts={state.drafts}
        comment={state.comment}
        showEmpty={state.emptyResult}
        remaining={remaining}
        blockedHint={blockedHint}
        editor={state.editor}
        foods={foods}
        recalculating={recalculating ?? state.recalc.pending !== null}
        recalcError={state.recalc.error}
        recalcInEditor={state.recalc.fromEditor === true}
        {...rest}
        onUndo={state.undo ? () => dispatch({ type: 'undo' }) : undefined}
        fallbackFocus={() => fallbackRef.current}
        onOpenItem={(itemId) => dispatch({ type: 'openItem', itemId })}
        onNewItem={() => dispatch({ type: 'newItem', itemId: `n${++rowSeq.current}` })}
        onEditorChange={(action) => dispatch({ type: 'editor', action })}
        onSaveItem={() => dispatch({ type: 'saveItem' })}
        onCloseItem={() => dispatch({ type: 'closeItem' })}
        onRemove={(itemId) => dispatch({ type: 'remove', itemId })}
        onRecalculate={onRecalculate}
      />
      {/* The AI row's line, unless the card's alert says the same. */}
      {blockedHint && blockedHint.text !== rest.recalcError && <p id={blockedHint.id}>{blockedHint.text}</p>}
      <ConfirmHost />
    </>
  );
}

/** The meal editor the card lives in: the item editor stacks over it. */
const InMealSheet = ({ children }: { children: ReactNode }) => (
  <Sheet open onClose={() => undefined} heading="Прийом їжі">
    {children}
  </Sheet>
);

const OFFLINE = { id: 'blocked-hint', text: 'Потрібен інтернет' };
const LIMIT = 'Ліміт підрахунків на сьогодні вичерпано';

const card = () => screen.getByRole('region', { name: 'Позиції' });
/** A position in the card, by the start of its accessible name («Борщ, 300 г, 260 ккал, …. Змінити»). */
const row = (name: string) =>
  within(card()).getByRole('button', { name: new RegExp(`^${name}, `) }) as HTMLButtonElement;
const editor = () => screen.getByRole('dialog', { name: /^(Позиція|Нова позиція)$/ });
const inEditor = () => within(editor());
const field = (name: string) => inEditor().getByRole('textbox', { name }) as HTMLInputElement;
const editorButton = (name: string | RegExp) => inEditor().getByRole('button', { name }) as HTMLButtonElement;
const recalcButton = () =>
  within(card()).queryByRole('button', { name: /Перерахувати|Рахую…/ }) as HTMLButtonElement | null;
/** «Разом 480 ккал». */
const totalLine = () => within(card()).getByText('Разом').parentElement?.textContent;
const editorGone = () =>
  waitFor(() => expect(screen.queryByRole('dialog', { name: /^(Позиція|Нова позиція)$/ })).toBeNull());

function openRow(name: string) {
  const button = row(name);
  button.focus();
  fireEvent.click(button);
  return button;
}

describe('EstimateCard: the list', () => {
  it('is a clean list of positions: one button each, no fields; «Разом» with Б · Ж · В', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Позиції' })).toBeTruthy();
    expect(screen.getByText('3 позиції · можна виправити')).toBeTruthy();
    expect(screen.getByText('Порції оцінені приблизно.')).toBeTruthy();
    expect(within(card()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(card()).getAllByRole('listitem')).toHaveLength(3);
    expect(row('Борщ').getAttribute('aria-label')).toBe(
      'Борщ, 300 г, 260 ккал, білки 6, жири 12, вуглеводи 25 г. Змінити',
    );
    expect(row('Хліб житній').textContent).toBe(
      `Хліб житній2 скибки · Б${NB}5${NB}· Ж${NB}1${NB}· В${NB}30160 ккал›`,
    );
    // No portion: name, kcal and the macros.
    expect(row('Сметана').getAttribute('aria-label')).toBe(
      'Сметана, 60 ккал, білки 1, жири 6, вуглеводи 1 г. Змінити',
    );
    expect(totalLine()).toBe('Разом480 ккал');
    expect(within(card()).getByText(flat(`Б${NB}12${NB}· Ж${NB}19${NB}· В${NB}56${NB}г`))).toBeTruthy();
    expect(recalcButton()).toBeNull();
    // Positions are the meal's: nothing to «add» or «cancel» any more.
    expect(within(card()).queryByRole('button', { name: /^Додати|^Скасувати|Спробувати/ })).toBeNull();
  });

  it('rowLabel / rowDetail say what is known, what waits for the model, what she typed', () => {
    const base: DraftItem = { ...emptyDraft('i0'), name: 'Котлета', portion: '1 шт', kcalText: '180' };
    expect(rowLabel(base, 0)).toBe('Котлета, 1 шт, 180 ккал, змінено. Змінити');
    expect(rowLabel({ ...base, pinned: true }, 0)).toBe('Котлета, 1 шт, 180 ккал, вписано вручну. Змінити');
    expect(rowLabel({ ...base, name: ' ', kcalText: '' }, 2)).toBe('Позиція 3, 1 шт, 0 ккал. Змінити');
    // A «Часті страви» dish's numbers are hers, but nothing she typed: no tag.
    expect(rowLabel({ ...base, pinned: true, fromDish: true }, 0)).toBe('Котлета, 1 шт, 180 ккал. Змінити');
    const grams = { ...base, pinned: true, proteinText: '24', carbsText: '0,5' };
    expect(rowLabel(grams, 0)).toBe(
      'Котлета, 1 шт, 180 ккал, білки 24, вуглеводи 1 г, вписано вручну. Змінити',
    );
    expect(rowDetail(grams)).toBe(`1 шт · Б${NB}24${NB}· В${NB}1`);
    expect(rowDetail({ ...grams, portion: '' })).toBe(`Б${NB}24${NB}· В${NB}1`);
    expect(rowDetail(base)).toBe('1 шт');
  });

  it('shows the remaining budget only when it is low', () => {
    const { unmount } = render(<Harness remaining={40} />);
    expect(screen.queryByText(/Сьогодні ще/)).toBeNull();
    unmount();
    render(<Harness remaining={4} />);
    expect(screen.getByText('Сьогодні ще 4 підрахунки')).toBeTruthy();
  });

  it('«Прибрати ці позиції» right after an estimate: named for what it does, takes the rows back', () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole('button', { name: UNDO_LABEL })).toBeNull();
    unmount();
    render(<Harness undoable />);
    const undo = screen.getByRole('button', { name: 'Прибрати ці позиції — останній підрахунок' });
    expect(UNDO_LABEL).toBe('Прибрати ці позиції — останній підрахунок');
    expect(undo.textContent).toBe('Прибрати ці позиції');
    // The name starts with the visible words, so a voice command for them finds it (WCAG 2.5.3).
    expect(undo.getAttribute('aria-label')?.startsWith(undo.textContent ?? '–')).toBe(true);
    undo.focus();
    fireEvent.click(undo);
    // All three came from that estimate: the card goes (focus is the editor's to move, see MealEditorBody).
    expect(screen.queryByRole('region', { name: 'Позиції' })).toBeNull();
  });
});

describe('EstimateCard: the item editor', () => {
  it('a row opens «Позиція» over the card, with the dialog focused (no keyboard)', () => {
    render(<Harness />);
    openRow('Борщ');
    expect(editor().getAttribute('aria-modal')).toBe('true');
    expect(field('Що це').value).toBe('Борщ');
    expect(document.activeElement).toBe(editor());
    expect(field('Скільки').value).toBe('300');
    expect(field('Скільки').getAttribute('inputmode')).toBe('decimal');
    const units = inEditor().getByRole('group', { name: 'Одиниця' });
    expect(within(units).getByRole('button', { name: 'г' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(units).getByRole('button', { name: 'шт' }).getAttribute('aria-pressed')).toBe('false');
    expect(inEditor().getByText('260')).toBeTruthy();
    // Б · Ж · В under the number, read out with it.
    const macros = inEditor().getByText(flat(`Б${NB}6${NB}· Ж${NB}12${NB}· В${NB}25${NB}г`));
    expect(macros.closest('[aria-live="polite"]')).toBe(
      inEditor().getByText('260').closest('[aria-live="polite"]'),
    );
    expect(editorButton('Готово')).toBeTruthy();
  });

  it('− / + and the multipliers change the amount; kcal and macros rescale live; «Готово» applies and focus returns', () => {
    render(<Harness />);
    const borshch = openRow('Борщ');
    fireEvent.click(editorButton('Збільшити'));
    expect(field('Скільки').value).toBe('310');
    expect(inEditor().getByText('269')).toBeTruthy();
    expect(inEditor().getByText('перераховано за вагою')).toBeTruthy();
    // Nothing is applied before «Готово».
    expect(row('Борщ').getAttribute('aria-label')).toBe(
      'Борщ, 300 г, 260 ккал, білки 6, жири 12, вуглеводи 25 г. Змінити',
    );

    const quick = inEditor().getByRole('group', { name: 'Від порції' });
    const half = within(quick).getByRole('button', { name: '½ — 150 г' });
    expect(within(quick).getByRole('button', { name: '×1 — 300 г' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(half);
    expect(half.getAttribute('aria-pressed')).toBe('true');
    expect(field('Скільки').value).toBe('150');
    expect(inEditor().getByText('130')).toBeTruthy();
    expect(inEditor().getByText(flat(`Б${NB}3${NB}· Ж${NB}6${NB}· В${NB}12,5${NB}г`))).toBeTruthy();

    fireEvent.change(field('Скільки'), { target: { value: '450' } });
    expect(inEditor().getByText('390')).toBeTruthy();

    fireEvent.click(editorButton('Готово'));
    expect(row('Борщ').getAttribute('aria-label')).toBe(
      'Борщ, 450 г, 390 ккал, білки 9, жири 18, вуглеводи 38 г. Змінити',
    );
    expect(totalLine()).toBe('Разом610 ккал');
    expect(document.activeElement).toBe(borshch);
    // Rescaled on the device: nothing for the model.
    expect(recalcButton()).toBeNull();
  });

  it('counts step by one and keep their plural forms; another unit starts afresh', () => {
    render(<Harness />);
    openRow('Хліб житній');
    expect(field('Скільки').value).toBe('2');
    expect(inEditor().getByText('скибки')).toBeTruthy();
    fireEvent.click(editorButton('Збільшити'));
    fireEvent.click(editorButton('Збільшити'));
    fireEvent.click(editorButton('Збільшити'));
    expect(field('Скільки').value).toBe('5');
    expect(inEditor().getByText('скибок')).toBeTruthy();
    expect(inEditor().getByText('400')).toBeTruthy();
    expect(inEditor().getByText('перераховано за кількістю')).toBeTruthy();

    fireEvent.click(
      within(inEditor().getByRole('group', { name: 'Одиниця' })).getByRole('button', { name: 'г' }),
    );
    expect(field('Скільки').value).toBe('100');
    expect(inEditor().getByText('змінено — уточни калорії')).toBeTruthy();
    fireEvent.click(editorButton('Готово'));
    // Grams the device cannot compare with slices: the numbers stay until the model answers.
    expect(row('Хліб житній').getAttribute('aria-label')).toBe(
      'Хліб житній, 100 г, 400 ккал, білки 13, жири 3, вуглеводи 75 г, змінено. Змінити',
    );
  });

  it('− at the smallest amount is locked but keeps her focus', () => {
    render(
      <Harness items={[{ name: 'Котлета', portion: '1 шт', kcal: 180, protein: 16, fat: 11, carbs: 5 }]} />,
    );
    openRow('Котлета');
    const minus = editorButton('Зменшити');
    minus.focus();
    expect(minus.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(minus);
    expect(field('Скільки').value).toBe('1');
    expect(document.activeElement).toBe(minus);
    // Half of one piece is not offered.
    expect(
      within(inEditor().getByRole('group', { name: 'Від порції' })).getByRole('button', { name: '½' }),
    ).toHaveProperty('disabled', true);
  });

  it('another name needs the model: «змінено» in the editor and on the row, «✨ Перерахувати» in both', () => {
    const onRecalculate = vi.fn();
    render(<Harness onRecalculate={onRecalculate} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    expect(inEditor().getByText('змінено — уточни калорії')).toBeTruthy();
    // The old numbers until the model answers.
    expect(inEditor().getByText('160')).toBeTruthy();
    fireEvent.click(editorButton('повернути: Хліб житній'));
    expect(field('Що це').value).toBe('Хліб житній');
    expect(inEditor().queryByText('змінено — уточни калорії')).toBeNull();
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });

    fireEvent.click(editorButton('Перерахувати'));
    expect(onRecalculate).toHaveBeenCalledOnce();

    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб білий').getAttribute('aria-label')).toBe(
      'Хліб білий, 2 скибки, 160 ккал, білки 5, жири 1, вуглеводи 30 г, змінено. Змінити',
    );
    expect(within(row('Хліб білий')).getByText('змінено')).toBeTruthy();
    const button = recalcButton();
    expect(button?.textContent).toBe('✨ Перерахувати');
    fireEvent.click(within(card()).getByRole('button', { name: 'Перерахувати' }));
    expect(onRecalculate).toHaveBeenCalledTimes(2);
  });

  it('a frequent dish from the suggestions takes its name, portion, kcal and macros: hers, no model needed', () => {
    render(<Harness />);
    openRow('Сметана');
    fireEvent.change(field('Що це'), { target: { value: 'СИР' } });
    const hints = inEditor().getByRole('group', { name: 'Підказки' });
    expect(
      within(hints)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['повернути: Сметана', 'Сирники, 3 шт, 450 ккал', 'Сир кисломолочний, 200 г, 240 ккал']);
    // Name and «· kcal» are two pieces (the space between them is the chip's gap, which a flex
    // container does not trim the way it trims a leading space).
    const chip = within(hints).getByRole('button', { name: 'Сирники, 3 шт, 450 ккал' });
    expect(Array.from(chip.children, (el) => el.textContent)).toEqual(['Сирники', '· 450']);
    fireEvent.click(chip);
    expect(field('Що це').value).toBe('Сирники');
    expect(field('Скільки').value).toBe('3');
    expect(inEditor().getByText('450')).toBeTruthy();
    expect(inEditor().getByText(flat(`Б${NB}24${NB}· Ж${NB}21${NB}· В${NB}39${NB}г`))).toBeTruthy();
    expect(inEditor().getByText('як у «Частих стравах»')).toBeTruthy();
    expect(inEditor().queryByRole('button', { name: /Перерахувати/ })).toBeNull();
    // Two of them: the dish's kcal and macros follow.
    fireEvent.click(editorButton('Зменшити'));
    expect(inEditor().getByText('300')).toBeTruthy();
    expect(inEditor().getByText(flat(`Б${NB}16${NB}· Ж${NB}14${NB}· В${NB}26${NB}г`))).toBeTruthy();

    fireEvent.click(editorButton('Готово'));
    // Her usual numbers, not a correction: the row is not tagged «вручну».
    expect(row('Сирники').getAttribute('aria-label')).toBe(
      'Сирники, 2 шт, 300 ккал, білки 16, жири 14, вуглеводи 26 г. Змінити',
    );
    expect(within(row('Сирники')).queryByText('вручну')).toBeNull();
    expect(recalcButton()).toBeNull();
    expect(totalLine()).toBe('Разом720 ккал');

    // Opened again, it is still the dish: the editor says so and its numbers follow the amount.
    openRow('Сирники');
    expect(inEditor().getByText('як у «Частих стравах»')).toBeTruthy();
    fireEvent.click(editorButton('Збільшити'));
    expect(inEditor().getByText('450')).toBeTruthy();
    expect(inEditor().queryByRole('button', { name: /Перерахувати/ })).toBeNull();
  });

  it('a frequent dish keeps following the amount while she retypes it (empty, «0», «0,5»)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    fireEvent.change(field('Що це'), { target: { value: 'кава' } });
    fireEvent.click(editorButton('Кава з молоком, 1 чашка, 60 ккал'));
    for (const value of ['', '2']) fireEvent.change(field('Скільки'), { target: { value } });
    expect(inEditor().getByText('120')).toBeTruthy();
    expect(inEditor().getByText('як у «Частих стравах»')).toBeTruthy();
    expect(inEditor().queryByRole('button', { name: /Порахувати/ })).toBeNull();
    for (const value of ['0', '0,', '0,5']) {
      fireEvent.change(field('Скільки'), { target: { value } });
      // Never «ще не пораховано» on the way.
      expect(inEditor().queryByText('ще не пораховано')).toBeNull();
    }
    expect(inEditor().getByText('30')).toBeTruthy();
    fireEvent.click(editorButton('Додати позицію'));
    // A dish without macros: none on the row.
    expect(row('Кава з молоком').getAttribute('aria-label')).toBe(
      'Кава з молоком, 0,5 чашки, 30 ккал. Змінити',
    );
  });

  it('«Вписати вручну»: kcal and Б · Ж · В fields; typed kcal rescale the macros she did not type', () => {
    render(<Harness />);
    openRow('Хліб житній');
    fireEvent.click(editorButton('Вписати вручну'));
    const kcal = field('Калорії');
    expect(document.activeElement).toBe(kcal);
    expect(kcal.value).toBe('160');
    expect(kcal.getAttribute('inputmode')).toBe('numeric');
    const protein = field('Білки');
    expect([field('Білки').value, field('Жири').value, field('Вуглеводи').value]).toEqual(['5', '1', '30']);
    expect(protein.getAttribute('inputmode')).toBe('decimal');
    // The «г» is decoration: the field is named by its label only.
    expect(protein.closest('label')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('г');
    fireEvent.change(kcal, { target: { value: '32o' } });
    expect(kcal.value).toBe('32');
    fireEvent.change(kcal, { target: { value: '320' } });
    expect([field('Білки').value, field('Жири').value, field('Вуглеводи').value]).toEqual(['10', '2', '60']);
    const note = inEditor().getByText('Б · Ж · В перераховано за калоріями');
    expect(field('Білки').getAttribute('aria-describedby')).toBe(note.id);
    expect(kcal.getAttribute('aria-describedby')).toBe(note.id);
    expect(inEditor().queryByRole('button', { name: 'Вписати вручну' })).toBeNull();
    // Her own grams: pinned, typed kcal leave them.
    fireEvent.change(field('Білки'), { target: { value: '12,5' } });
    fireEvent.change(kcal, { target: { value: '300' } });
    expect(field('Білки').value).toBe('12,5');
    expect(inEditor().getByText('вписано вручну')).toBeTruthy();
    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб житній').getAttribute('aria-label')).toBe(
      'Хліб житній, 2 скибки, 300 ккал, білки 13, жири 2, вуглеводи 60 г, вписано вручну. Змінити',
    );
    expect(totalLine()).toBe('Разом620 ккал');
  });

  it('a portion it cannot read stays text; «Порція текстом» lets her write one', async () => {
    render(
      <Harness
        items={[
          { name: 'Суп', portion: 'велика тарілка', kcal: 300, protein: null, fat: null, carbs: null },
          ...ITEMS,
        ]}
      />,
    );
    openRow('Суп');
    expect(field('Скільки').value).toBe('велика тарілка');
    expect(inEditor().queryByRole('group', { name: 'Одиниця' })).toBeNull();
    fireEvent.click(editorButton('Вказати кількістю'));
    expect(document.activeElement).toBe(field('Скільки'));
    expect(field('Скільки').value).toBe('');
    // Only switching the field changed nothing yet.
    fireEvent.click(editorButton('Закрити'));
    await editorGone();

    openRow('Сметана');
    fireEvent.click(editorButton('Порція текстом'));
    expect(document.activeElement).toBe(field('Скільки'));
    fireEvent.change(field('Скільки'), { target: { value: '2 ст. л.' } });
    fireEvent.click(editorButton('Готово'));
    expect(row('Сметана').getAttribute('aria-label')).toBe(
      'Сметана, 2 ст. л., 60 ккал, білки 1, жири 6, вуглеводи 1 г, змінено. Змінити',
    );
  });

  it('✕ on an untouched draft closes at once; a changed one asks first', async () => {
    render(<Harness />);
    const bread = openRow('Хліб житній');
    fireEvent.click(editorButton('Закрити'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(bread);
    await editorGone();

    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Закрити'));
    const ask = await screen.findByRole('alertdialog', { name: 'Скасувати зміни?' });
    // Destructive: focus starts on staying.
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Залишитись' }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Залишитись' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(field('Що це').value).toBe('Хліб білий');

    // Escape asks the same.
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Скасувати зміни?' })).getByRole('button', {
        name: 'Скасувати зміни',
      }),
    );
    await editorGone();
    expect(row('Хліб житній').getAttribute('aria-label')).toMatch(/^Хліб житній, 2 скибки, 160 ккал, /);
    expect(document.activeElement).toBe(row('Хліб житній'));
  });

  it('«Видалити позицію» removes it without asking; focus goes to the next row, the previous one, then on', async () => {
    render(<Harness />);
    openRow('Борщ');
    fireEvent.click(editorButton('Видалити позицію'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('2 позиції · можна виправити')).toBeTruthy();
    expect(document.activeElement).toBe(row('Хліб житній'));
    await editorGone();

    openRow('Сметана');
    fireEvent.click(editorButton('Видалити позицію'));
    expect(document.activeElement).toBe(row('Хліб житній'));
    await editorGone();

    // The last one: the card goes with it, focus goes where the editor says (the AI row here).
    openRow('Хліб житній');
    fireEvent.click(editorButton('Видалити позицію'));
    expect(screen.queryByRole('region', { name: 'Позиції' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Порахувати' }));
    await editorGone();
  });

  it('«+ позиція» opens «Нова позиція» with the name focused; «Додати позицію» puts it in the list', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(editor().getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Нова позиція' })).toBeTruthy();
    const name = field('Що це');
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('');
    const save = editorButton('Додати позицію');
    expect(save.disabled).toBe(true);
    // No delete for a row that is not there yet.
    expect(inEditor().queryByRole('button', { name: 'Видалити позицію' })).toBeNull();
    // Nothing typed yet: the most used dishes.
    expect(within(inEditor().getByRole('group', { name: 'Підказки' })).getAllByRole('button')).toHaveLength(
      3,
    );

    fireEvent.change(name, { target: { value: 'Чай' } });
    expect(inEditor().getByText('ще не пораховано')).toBeTruthy();
    expect(editorButton('Порахувати')).toBeTruthy();
    fireEvent.click(editorButton('Збільшити'));
    expect(field('Скільки').value).toBe('100');
    fireEvent.click(
      within(inEditor().getByRole('group', { name: 'Одиниця' })).getByRole('button', { name: 'мл' }),
    );
    expect(field('Скільки').value).toBe('250');
    fireEvent.change(field('Скільки'), { target: { value: '300' } });
    fireEvent.click(editorButton('Вписати вручну'));
    fireEvent.change(field('Калорії'), { target: { value: '5' } });
    // Nothing to rescale a new row's macros from: «—».
    expect(field('Білки').value).toBe('');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(screen.getByText('4 позиції · можна виправити')).toBeTruthy();
    expect(row('Чай').getAttribute('aria-label')).toBe('Чай, 300 мл, 5 ккал, вписано вручну. Змінити');
    expect(document.activeElement).toBe(row('Чай'));
    expect(totalLine()).toBe('Разом485 ккал');
  });

  it('a new row closed untouched adds nothing and gives focus back to «+ позиція»', async () => {
    render(<Harness />);
    const plus = screen.getByRole('button', { name: '+ позиція' });
    fireEvent.click(plus);
    fireEvent.click(editorButton('Закрити'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(plus);
    await editorGone();
    expect(screen.getByText('3 позиції · можна виправити')).toBeTruthy();
  });

  it('a name cleared on a row: «Готово» waits for one', () => {
    render(<Harness />);
    openRow('Борщ');
    fireEvent.change(field('Що це'), { target: { value: '' } });
    expect(editorButton('Готово').disabled).toBe(true);
    expect(inEditor().getByText('Без назви позицію не зберегти')).toBeTruthy();
  });

  it('over the meal editor: «Готово» and «Видалити позицію» put focus back in the list', async () => {
    render(
      <InMealSheet>
        <Harness />
      </InMealSheet>,
    );
    const meal = screen.getByRole('dialog', { name: 'Прийом їжі' });
    const bread = openRow('Хліб житній');
    // The meal editor sleeps under the item editor.
    expect(meal.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(editorButton('Збільшити'));
    fireEvent.click(editorButton('Готово'));
    expect(meal.parentElement?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(bread);
    await editorGone();
    expect(document.activeElement).toBe(bread);

    openRow('Хліб житній');
    fireEvent.click(editorButton('Видалити позицію'));
    expect(document.activeElement).toBe(row('Сметана'));
    await editorGone();
    expect(document.activeElement).toBe(row('Сметана'));

    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    fireEvent.change(field('Що це'), { target: { value: 'Чай' } });
    fireEvent.click(editorButton('Додати позицію'));
    expect(document.activeElement).toBe(row('Чай'));
    await editorGone();
    expect(document.activeElement).toBe(row('Чай'));
  });
});

describe('EstimateCard: recalculation', () => {
  it('while recalculating: «Рахую…», still focusable, a second tap does nothing', () => {
    const onRecalculate = vi.fn();
    const { rerender } = render(<Harness onRecalculate={onRecalculate} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Готово'));
    rerender(<Harness onRecalculate={onRecalculate} recalculating />);
    const button = recalcButton();
    expect(button?.textContent).toBe('Рахую…');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(card()).getByRole('button', { name: 'Рахую…' }));
    expect(onRecalculate).not.toHaveBeenCalled();
  });

  it('when «Перерахувати» goes away under her focus, focus moves on to «+ позиція»', async () => {
    const dispatchRef = createRef<Dispatch<EstimateAction>>();
    render(<Harness dispatchRef={dispatchRef} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Готово'));
    await editorGone();
    recalcButton()?.focus();
    act(() => dispatchRef.current?.({ type: 'recalcStart', id: 2 }));
    expect(recalcButton()?.textContent).toBe('Рахую…');
    const rows = [
      { id: 'i0', name: 'Борщ', portion: '300 г' },
      { id: 'i1', name: 'Хліб білий', portion: '2 скибки' },
      { id: 'i2', name: 'Сметана', portion: '' },
    ];
    const res = {
      photoId: null,
      items: rows.map((r) => ({ ...r, kcal: 170, protein: 4, fat: 1.5, carbs: 32 })),
      totalKcal: 0,
      comment: '',
    };
    act(() => dispatchRef.current?.({ type: 'recalcResolve', id: 2, rows, res }));
    expect(recalcButton()).toBeNull();
    // The model's kcal and macros for the row that waited.
    expect(row('Хліб білий').getAttribute('aria-label')).toBe(
      'Хліб білий, 2 скибки, 170 ккал, білки 4, жири 2, вуглеводи 32 г. Змінити',
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ позиція' }));
  });

  it('asked in the editor: «Рахую…», then the draft takes the model’s numbers; focus stays in the editor', () => {
    const dispatchRef = createRef<Dispatch<EstimateAction>>();
    const onRecalculate = vi.fn(() => dispatchRef.current?.({ type: 'recalcStart', id: 3 }));
    render(<Harness dispatchRef={dispatchRef} onRecalculate={onRecalculate} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    const ask = editorButton('Перерахувати');
    // In the footer, next to «Готово»: in view however far the fields scroll.
    expect(ask.parentElement).toBe(editorButton('Готово').parentElement);
    expect(
      ask.compareDocumentPosition(editorButton('Готово')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    ask.focus();
    act(() => ask.click());
    expect(onRecalculate).toHaveBeenCalledOnce();
    expect(ask.textContent).toBe('Рахую…');
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    // «Готово» does not have to wait; the card behind says «Рахую…» too.
    expect(recalcButton()?.textContent).toBe('Рахую…');

    const rows = [
      { id: 'i0', name: 'Борщ', portion: '300 г' },
      { id: 'i1', name: 'Хліб білий', portion: '2 скибки' },
      { id: 'i2', name: 'Сметана', portion: '' },
    ];
    const res = {
      photoId: null,
      items: rows.map((r) => ({ ...r, kcal: 150, protein: 5, fat: 1, carbs: 28 })),
      totalKcal: 0,
      comment: '',
    };
    act(() => dispatchRef.current?.({ type: 'recalcResolve', id: 3, rows, res }));
    const kcal = inEditor().getByText('150');
    expect(kcal.closest('[aria-live="polite"]')).not.toBeNull();
    expect(inEditor().getByText(flat(`Б${NB}5${NB}· Ж${NB}1${NB}· В${NB}28${NB}г`))).toBeTruthy();
    expect(inEditor().queryByText('змінено — уточни калорії')).toBeNull();
    // Its button went away under her focus: on to «Готово» next to it, still in the editor.
    expect(inEditor().queryByRole('button', { name: /Перерахувати|Рахую…/ })).toBeNull();
    expect(document.activeElement).toBe(editorButton('Готово'));
    // Not in the list until «Готово».
    expect(row('Хліб житній')).toBeTruthy();
    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб білий').getAttribute('aria-label')).toBe(
      'Хліб білий, 2 скибки, 150 ккал, білки 5, жири 1, вуглеводи 28 г. Змінити',
    );
    expect(totalLine()).toBe('Разом470 ккал');
  });

  it('offline or out of estimates: «Перерахувати» is locked, says why, and keeps her focus', () => {
    const onRecalculate = vi.fn();
    const { rerender } = render(<Harness onRecalculate={onRecalculate} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Готово'));
    rerender(<Harness onRecalculate={onRecalculate} recalculating />);
    recalcButton()?.focus();
    rerender(<Harness onRecalculate={onRecalculate} blockedHint={OFFLINE} />);
    const button = recalcButton();
    expect(button?.textContent).toBe('✨ Перерахувати');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.className).not.toMatch(/busy/);
    expect(button?.getAttribute('aria-describedby')).toBe('blocked-hint');
    expect(document.activeElement).toBe(button);
    fireEvent.click(within(card()).getByRole('button', { name: 'Перерахувати' }));
    expect(onRecalculate).not.toHaveBeenCalled();
  });

  it('in the editor too: locked offline with the reason, and kcal can still be typed', () => {
    const onRecalculate = vi.fn();
    render(<Harness onRecalculate={onRecalculate} blockedHint={OFFLINE} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    const button = editorButton('Перерахувати');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const why = inEditor().getByText('Потрібен інтернет — калорії можна вписати вручну');
    expect(button.getAttribute('aria-describedby')).toBe(why.id);
    fireEvent.click(button);
    expect(onRecalculate).not.toHaveBeenCalled();
    fireEvent.click(editorButton('Вписати вручну'));
    fireEvent.change(field('Калорії'), { target: { value: '150' } });
    expect(inEditor().queryByRole('button', { name: /Перерахувати/ })).toBeNull();
  });

  it('asked in the editor: «Рахую…» there, its failure is the editor’s alert (the card’s line is not a second one)', () => {
    const { rerender } = render(<Harness />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    rerender(<Harness recalculating recalcInEditor />);
    expect(editorButton('Рахую…').getAttribute('aria-disabled')).toBe('true');
    const message = 'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну';
    rerender(<Harness recalcError={message} recalcInEditor />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(inEditor().getByRole('alert').textContent).toBe(message);
    expect(editorButton('Перерахувати')).toBeTruthy();
  });

  it('a failure asked in the editor goes with the draft she drops, and stays with the one she keeps', async () => {
    const dispatchRef = createRef<Dispatch<EstimateAction>>();
    let id = 10;
    const onRecalculate = vi.fn(() => dispatchRef.current?.({ type: 'recalcStart', id: ++id }));
    render(<Harness dispatchRef={dispatchRef} onRecalculate={onRecalculate} />);
    const message = 'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну';
    const askAndFail = () => {
      fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
      act(() => editorButton('Перерахувати').click());
      act(() => dispatchRef.current?.({ type: 'recalcFail', id, message }));
      expect(inEditor().getByRole('alert').textContent).toBe(message);
    };

    openRow('Хліб житній');
    askAndFail();
    fireEvent.click(editorButton('Закрити'));
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Скасувати зміни?' })).getByRole('button', {
        name: 'Скасувати зміни',
      }),
    );
    await editorGone();
    // Nothing in the list is «змінено»: an alert there would be about a row that does not exist.
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(recalcButton()).toBeNull();

    // Kept with «Готово»: her row waits for the model, the card says why it failed.
    openRow('Хліб житній');
    expect(inEditor().queryByRole('alert')).toBeNull();
    askAndFail();
    fireEvent.click(editorButton('Готово'));
    await editorGone();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(recalcButton()?.textContent).toBe('✨ Перерахувати');
    // Another row opened later does not repeat it.
    openRow('Борщ');
    expect(inEditor().queryByRole('alert')).toBeNull();
  });

  it('a failure asked from the card is not repeated in the editor', () => {
    render(<Harness recalcError="Немає зʼєднання з сервером" />);
    expect(screen.getByRole('alert').textContent).toBe('Немає зʼєднання з сервером');
    openRow('Борщ');
    expect(inEditor().queryByRole('alert')).toBeNull();
    // Behind the editor the card's line is plain text: one alert at a time.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('a failed recalculation is an inline alert (one line with the limit hint)', () => {
    const { rerender } = render(<Harness recalcError="Немає зʼєднання з сервером" />);
    expect(screen.getByRole('alert').hasAttribute('id')).toBe(false);
    rerender(<Harness remaining={0} recalcError={LIMIT} />);
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(LIMIT);
  });

  it('a 429 on «Перерахувати»: the alert becomes the blocked hint the buttons are described by', () => {
    const limit = { id: 'blocked-hint', text: LIMIT };
    render(<Harness remaining={0} recalcError={LIMIT} blockedHint={limit} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Готово'));
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('blocked-hint');
    expect(recalcButton()?.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('out of estimates: the card does not repeat the AI row’s «Ліміт…» line', () => {
    render(<Harness remaining={0} blockedHint={{ id: 'blocked-hint', text: LIMIT }} />);
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    expect(screen.getByText(LIMIT).id).toBe('blocked-hint');
  });
});

describe('EstimateCard: nothing found', () => {
  const props = (over: Partial<EstimateCardProps> = {}): EstimateCardProps => ({
    drafts: [],
    comment: '',
    remaining: null,
    foods: [],
    onOpenItem: () => undefined,
    onNewItem: () => undefined,
    onEditorChange: () => undefined,
    onSaveItem: () => undefined,
    onCloseItem: () => undefined,
    onRemove: () => undefined,
    onRecalculate: () => undefined,
    ...over,
  });

  it('the advice and «+ позиція», nothing to add or take back', () => {
    const onNewItem = vi.fn();
    render(
      <EstimateCard
        {...props({ showEmpty: true, comment: 'Схоже, на фото немає їжі.', onNewItem, onUndo: vi.fn() })}
      />,
    );
    expect(screen.getByText('Нічого не знайдено')).toBeTruthy();
    expect(screen.getByText('Схоже, на фото немає їжі.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Додати|Скасувати|Спробувати|Прибрати/ })).toBeNull();
    expect(screen.queryByText('Разом')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(onNewItem).toHaveBeenCalledOnce();
  });

  it('no rows and no empty result: no card at all (the manual numbers take its place)', () => {
    render(<EstimateCard {...props()} />);
    expect(screen.queryByRole('region', { name: 'Позиції' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ позиція' })).toBeNull();
  });

  it('the title can take focus (programmatically only) and still names the card', () => {
    const titleRef = createRef<HTMLSpanElement>();
    render(<EstimateCard {...props({ drafts: positionsOf().drafts, titleRef })} />);
    expect(screen.getByRole('region', { name: 'Позиції' })).toBeTruthy();
    expect(titleRef.current?.tabIndex).toBe(-1);
    titleRef.current?.focus();
    expect(document.activeElement).toBe(titleRef.current);
    expect(screen.getByRole('heading', { name: 'Позиції' }).contains(titleRef.current)).toBe(true);
  });
});

describe('EstimateLoading', () => {
  it('shows progress and can be cancelled (the editor announces it)', () => {
    const onCancel = vi.fn();
    const cancelRef = createRef<HTMLButtonElement>();
    render(<EstimateLoading photo preview={null} onCancel={onCancel} cancelRef={cancelRef} />);
    expect(screen.getByText('Рахую калорії…')).toBeTruthy();
    // Not a live region of its own: one inserted with its text already inside is often not read.
    expect(screen.queryByRole('status')).toBeNull();
    expect(cancelRef.current).toBe(screen.getByRole('button', { name: 'Скасувати' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

import type { FoodItem } from '@legko/shared';
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
import { draftsToItems, type DraftItem } from './drafts';
import { EstimateCard, EstimateLoading, rowLabel, type EstimateCardProps } from './EstimateCard';
import { estimateReducer, IDLE, type EstimateAction, type EstimatePhase } from './estimate';

beforeAll(() => installMatchMedia());
beforeEach(() => {
  stubScrollTo();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ITEMS = [
  { name: 'Борщ', portion: '300 г', kcal: 260 },
  { name: 'Хліб житній', portion: '2 скибки', kcal: 160 },
  { name: 'Сметана', portion: '', kcal: 60 },
];

const FOODS: FoodItem[] = [
  { name: 'Сирники', portion: '3 шт', kcal: 450, count: 5, lastUsed: '2026-10-01' },
  { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 9, lastUsed: '2026-10-08' },
  { name: 'Сир кисломолочний', portion: '200 г', kcal: 240, count: 2, lastUsed: '2026-10-02' },
];

function resultOf(items = ITEMS): EstimatePhase {
  const loading = estimateReducer(IDLE, { type: 'start', id: 1, photo: true, consumed: '' });
  return estimateReducer(loading, {
    type: 'resolve',
    id: 1,
    res: { photoId: null, items, totalKcal: 0, comment: 'Порції оцінені приблизно.' },
  });
}

type HarnessProps = Partial<
  Pick<
    EstimateCardProps,
    'remaining' | 'recalculating' | 'recalcError' | 'recalcInEditor' | 'blockedHint' | 'foods'
  >
> & {
  onAdd?: (drafts: readonly DraftItem[]) => void;
  onRecalculate?: () => void;
  items?: typeof ITEMS;
  /** Lets a test feed the reducer what the hook would (a recalculation and its answer). */
  dispatchRef?: RefObject<Dispatch<EstimateAction> | null>;
};

/** Card wired to the estimate reducer, as FoodAssist does through `useFoodEstimate`. */
function Harness({
  onAdd = () => undefined,
  onRecalculate = () => undefined,
  items,
  remaining = 40,
  blockedHint,
  foods = FOODS,
  dispatchRef,
  recalculating,
  ...rest
}: HarnessProps) {
  const [phase, dispatch] = useReducer(estimateReducer, items, resultOf);
  const rowSeq = useRef(0);
  useEffect(() => {
    if (dispatchRef) dispatchRef.current = dispatch;
  }, [dispatchRef]);
  if (phase.kind !== 'result') return null;
  return (
    <>
      <EstimateCard
        drafts={phase.drafts}
        comment={phase.comment}
        preview={null}
        remaining={remaining}
        blockedHint={blockedHint}
        editor={phase.editor}
        foods={foods}
        recalculating={recalculating ?? phase.recalc.pending !== null}
        recalcError={phase.recalc.error}
        recalcInEditor={phase.recalc.fromEditor === true}
        {...rest}
        onOpenItem={(itemId) => dispatch({ type: 'openItem', itemId })}
        onNewItem={() => dispatch({ type: 'newItem', itemId: `n${++rowSeq.current}` })}
        onEditorChange={(action) => dispatch({ type: 'editor', action })}
        onSaveItem={() => dispatch({ type: 'saveItem' })}
        onCloseItem={() => dispatch({ type: 'closeItem' })}
        onRemove={(itemId) => dispatch({ type: 'remove', itemId })}
        onRecalculate={onRecalculate}
        onAdd={() => onAdd(phase.drafts)}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />
      {/* FoodAssist's line under ✨/📷, unless the card's alert says the same. */}
      {blockedHint && blockedHint.text !== rest.recalcError && <p id={blockedHint.id}>{blockedHint.text}</p>}
      <ConfirmHost />
    </>
  );
}

/** The day sheet the card lives in: the editor stacks over it. */
const InDaySheet = ({ children }: { children: ReactNode }) => (
  <Sheet open onClose={() => undefined} heading="Запис дня">
    {children}
  </Sheet>
);

const OFFLINE = { id: 'blocked-hint', text: 'Потрібен інтернет' };
const LIMIT = 'Ліміт підрахунків на сьогодні вичерпано';

const card = () => screen.getByRole('region', { name: 'Оцінка калорій' });
/** A position in the card, by the start of its accessible name («Борщ, 300 г, 260 ккал. Змінити»). */
const row = (name: string) =>
  within(card()).getByRole('button', { name: new RegExp(`^${name}, `) }) as HTMLButtonElement;
const editor = () => screen.getByRole('dialog', { name: /^(Позиція|Нова позиція)$/ });
const inEditor = () => within(editor());
const field = (name: string) => inEditor().getByRole('textbox', { name }) as HTMLInputElement;
const editorButton = (name: string | RegExp) => inEditor().getByRole('button', { name }) as HTMLButtonElement;
const recalcButton = () =>
  within(card()).queryByRole('button', { name: /Перерахувати|Рахую…/ }) as HTMLButtonElement | null;
const addButton = () => screen.getByRole('button', { name: /^Додати \d+ ккал$/ }) as HTMLButtonElement;
const editorGone = () =>
  waitFor(() => expect(screen.queryByRole('dialog', { name: /^(Позиція|Нова позиція)$/ })).toBeNull());

function openRow(name: string) {
  const button = row(name);
  button.focus();
  fireEvent.click(button);
  return button;
}

describe('EstimateCard: the list', () => {
  it('is a clean list of positions: one button each, no fields; total and «Додати»', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Оцінка калорій' })).toBeTruthy();
    expect(screen.getByText('3 позиції · можна виправити')).toBeTruthy();
    expect(screen.getByText('Порції оцінені приблизно.')).toBeTruthy();
    expect(within(card()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(card()).getAllByRole('listitem')).toHaveLength(3);
    expect(row('Борщ').getAttribute('aria-label')).toBe('Борщ, 300 г, 260 ккал. Змінити');
    expect(row('Хліб житній').textContent).toBe('Хліб житній2 скибки160 ккал›');
    // No portion: name and kcal only.
    expect(row('Сметана').getAttribute('aria-label')).toBe('Сметана, 60 ккал. Змінити');
    expect(addButton().textContent).toBe('Додати 480 ккал');
    expect(recalcButton()).toBeNull();
  });

  it('rowLabel says what is waiting for the model or typed by hand', () => {
    const base = { id: 'i0', name: 'Котлета', portion: '1 шт', kcalText: '180', base: null, pinned: false };
    expect(rowLabel(base, 0)).toBe('Котлета, 1 шт, 180 ккал, змінено. Змінити');
    expect(rowLabel({ ...base, pinned: true }, 0)).toBe('Котлета, 1 шт, 180 ккал, вписано вручну. Змінити');
    expect(rowLabel({ ...base, name: ' ', kcalText: '' }, 2)).toBe('Позиція 3, 1 шт, 0 ккал. Змінити');
    // A «Часті страви» dish's numbers are hers, but nothing she typed: no tag.
    expect(rowLabel({ ...base, pinned: true, fromDish: true }, 0)).toBe('Котлета, 1 шт, 180 ккал. Змінити');
  });

  it('shows the remaining budget only when it is low', () => {
    const { unmount } = render(<Harness remaining={40} />);
    expect(screen.queryByText(/Сьогодні ще/)).toBeNull();
    unmount();
    render(<Harness remaining={4} />);
    expect(screen.getByText('Сьогодні ще 4 підрахунки')).toBeTruthy();
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
    expect(editorButton('Готово')).toBeTruthy();
  });

  it('− / + and the multipliers change the amount; kcal rescale live; «Готово» applies and focus returns to the row', () => {
    render(<Harness />);
    const borshch = openRow('Борщ');
    fireEvent.click(editorButton('Збільшити'));
    expect(field('Скільки').value).toBe('310');
    expect(inEditor().getByText('269')).toBeTruthy();
    expect(inEditor().getByText('перераховано за вагою')).toBeTruthy();
    // Nothing is applied before «Готово».
    expect(row('Борщ').getAttribute('aria-label')).toBe('Борщ, 300 г, 260 ккал. Змінити');

    const quick = inEditor().getByRole('group', { name: 'Від порції' });
    const half = within(quick).getByRole('button', { name: '½ — 150 г' });
    expect(within(quick).getByRole('button', { name: '×1 — 300 г' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(half);
    expect(half.getAttribute('aria-pressed')).toBe('true');
    expect(field('Скільки').value).toBe('150');
    expect(inEditor().getByText('130')).toBeTruthy();

    fireEvent.change(field('Скільки'), { target: { value: '450' } });
    expect(inEditor().getByText('390')).toBeTruthy();

    fireEvent.click(editorButton('Готово'));
    expect(row('Борщ').getAttribute('aria-label')).toBe('Борщ, 450 г, 390 ккал. Змінити');
    expect(addButton().textContent).toBe('Додати 610 ккал');
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
    expect(row('Хліб житній').getAttribute('aria-label')).toBe(
      'Хліб житній, 100 г, 400 ккал, змінено. Змінити',
    );
  });

  it('− at the smallest amount is locked but keeps her focus', () => {
    render(<Harness items={[{ name: 'Котлета', portion: '1 шт', kcal: 180 }]} />);
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
    // The old number until the model answers.
    expect(inEditor().getByText('160')).toBeTruthy();
    fireEvent.click(editorButton('повернути: Хліб житній'));
    expect(field('Що це').value).toBe('Хліб житній');
    expect(inEditor().queryByText('змінено — уточни калорії')).toBeNull();
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });

    fireEvent.click(editorButton('Перерахувати'));
    expect(onRecalculate).toHaveBeenCalledOnce();

    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб білий').getAttribute('aria-label')).toBe(
      'Хліб білий, 2 скибки, 160 ккал, змінено. Змінити',
    );
    expect(within(row('Хліб білий')).getByText('змінено')).toBeTruthy();
    const button = recalcButton();
    expect(button?.textContent).toBe('✨ Перерахувати');
    // Right above «Додати».
    expect(
      button && button.compareDocumentPosition(addButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: 'Перерахувати' }));
    expect(onRecalculate).toHaveBeenCalledTimes(2);
  });

  it('a frequent dish from the suggestions takes its name, portion and kcal: hers, no model needed', () => {
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
    expect(inEditor().getByText('як у «Частих стравах»')).toBeTruthy();
    expect(inEditor().queryByRole('button', { name: /Перерахувати/ })).toBeNull();
    // Two of them: the dish's kcal follow.
    fireEvent.click(editorButton('Зменшити'));
    expect(inEditor().getByText('300')).toBeTruthy();

    fireEvent.click(editorButton('Готово'));
    // Her usual numbers, not a correction: the row is not tagged «вручну».
    expect(row('Сирники').getAttribute('aria-label')).toBe('Сирники, 2 шт, 300 ккал. Змінити');
    expect(within(row('Сирники')).queryByText('вручну')).toBeNull();
    expect(recalcButton()).toBeNull();
    expect(addButton().textContent).toBe('Додати 720 ккал');

    // Opened again, it is still the dish: the editor says so and its kcal follow the amount.
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
    expect(row('Кава з молоком').getAttribute('aria-label')).toBe(
      'Кава з молоком, 0,5 чашки, 30 ккал. Змінити',
    );
  });

  it('«Вписати вручну» turns the number into a field: her kcal pin the row', () => {
    render(<Harness />);
    openRow('Хліб житній');
    fireEvent.click(editorButton('Вписати вручну'));
    const kcal = field('Калорії');
    expect(document.activeElement).toBe(kcal);
    expect(kcal.value).toBe('160');
    expect(kcal.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(kcal, { target: { value: '19o' } });
    expect(kcal.value).toBe('19');
    fireEvent.change(kcal, { target: { value: '190' } });
    expect(inEditor().getByText('вписано вручну')).toBeTruthy();
    expect(inEditor().queryByRole('button', { name: 'Вписати вручну' })).toBeNull();
    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб житній').getAttribute('aria-label')).toBe(
      'Хліб житній, 2 скибки, 190 ккал, вписано вручну. Змінити',
    );
    expect(addButton().textContent).toBe('Додати 510 ккал');
  });

  it('a portion it cannot read stays text; «Порція текстом» lets her write one', async () => {
    render(<Harness items={[{ name: 'Суп', portion: 'велика тарілка', kcal: 300 }, ...ITEMS]} />);
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
    expect(row('Сметана').getAttribute('aria-label')).toBe('Сметана, 2 ст. л., 60 ккал, змінено. Змінити');
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
    expect(row('Хліб житній').getAttribute('aria-label')).toBe('Хліб житній, 2 скибки, 160 ккал. Змінити');
    expect(document.activeElement).toBe(row('Хліб житній'));
  });

  it('«Видалити позицію» removes it without asking; focus goes to the next row, else the previous one', async () => {
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

    openRow('Хліб житній');
    fireEvent.click(editorButton('Видалити позицію'));
    expect(screen.getByText('Нічого не знайдено')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ позиція' }));
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
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(screen.getByText('4 позиції · можна виправити')).toBeTruthy();
    expect(row('Чай').getAttribute('aria-label')).toBe('Чай, 300 мл, 5 ккал, вписано вручну. Змінити');
    expect(document.activeElement).toBe(row('Чай'));
    expect(addButton().textContent).toBe('Додати 485 ккал');
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

  it('over the day sheet: «Готово» and «Видалити позицію» put focus back in the list', async () => {
    render(
      <InDaySheet>
        <Harness />
      </InDaySheet>,
    );
    const day = screen.getByRole('dialog', { name: 'Запис дня' });
    const bread = openRow('Хліб житній');
    // The day sheet sleeps under the editor.
    expect(day.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(editorButton('Збільшити'));
    fireEvent.click(editorButton('Готово'));
    expect(day.parentElement?.hasAttribute('inert')).toBe(false);
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

  it('«Додати» waits for «Рахую…»: focusable, says what it waits for, a tap adds nothing', () => {
    const onAdd = vi.fn();
    const { rerender } = render(<Harness onAdd={onAdd} />);
    openRow('Хліб житній');
    fireEvent.change(field('Що це'), { target: { value: 'Хліб білий' } });
    fireEvent.click(editorButton('Готово'));
    rerender(<Harness onAdd={onAdd} recalculating />);
    const add = addButton();
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe(recalcButton()?.id);
    add.focus();
    fireEvent.click(add);
    expect(onAdd).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(add);

    // The answer is in: «Додати» adds again, her name with the numbers on screen.
    rerender(<Harness onAdd={onAdd} />);
    expect(addButton().hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(addButton());
    expect(draftsToItems(onAdd.mock.calls[0]![0] as DraftItem[])[1]).toEqual({
      name: 'Хліб білий',
      portion: '2 скибки',
      kcal: 160,
    });
  });

  it('when «Перерахувати» goes away under her focus, focus moves on to «Додати»', async () => {
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
    const res = { photoId: null, items: rows.map((r) => ({ ...r, kcal: 170 })), totalKcal: 0, comment: '' };
    act(() => dispatchRef.current?.({ type: 'recalcResolve', id: 2, rows, res }));
    expect(recalcButton()).toBeNull();
    expect(row('Хліб білий').getAttribute('aria-label')).toBe('Хліб білий, 2 скибки, 170 ккал. Змінити');
    expect(document.activeElement).toBe(addButton());
  });

  it('asked in the editor: «Рахую…», then the draft takes the model’s kcal; focus stays in the editor', () => {
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
    const res = { photoId: null, items: rows.map((r) => ({ ...r, kcal: 150 })), totalKcal: 0, comment: '' };
    act(() => dispatchRef.current?.({ type: 'recalcResolve', id: 3, rows, res }));
    const kcal = inEditor().getByText('150');
    expect(kcal.closest('[aria-live="polite"]')).not.toBeNull();
    expect(inEditor().queryByText('змінено — уточни калорії')).toBeNull();
    // Its button went away under her focus: on to «Готово» next to it, still in the editor.
    expect(inEditor().queryByRole('button', { name: /Перерахувати|Рахую…/ })).toBeNull();
    expect(document.activeElement).toBe(editorButton('Готово'));
    // Not in the list until «Готово».
    expect(row('Хліб житній')).toBeTruthy();
    fireEvent.click(editorButton('Готово'));
    expect(row('Хліб білий').getAttribute('aria-label')).toBe('Хліб білий, 2 скибки, 150 ккал. Змінити');
    expect(addButton().textContent).toBe('Додати 470 ккал');
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
    expect(addButton().hasAttribute('aria-disabled')).toBe(false);
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

  it('out of estimates: the card does not repeat the sheet’s «Ліміт…» line', () => {
    render(<Harness remaining={0} blockedHint={{ id: 'blocked-hint', text: LIMIT }} />);
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    expect(screen.getByText(LIMIT).id).toBe('blocked-hint');
  });
});

describe('EstimateCard: nothing found', () => {
  const props = (over: Partial<EstimateCardProps> = {}): EstimateCardProps => ({
    drafts: [],
    comment: '',
    preview: null,
    remaining: null,
    foods: [],
    onOpenItem: () => undefined,
    onNewItem: () => undefined,
    onEditorChange: () => undefined,
    onSaveItem: () => undefined,
    onCloseItem: () => undefined,
    onRemove: () => undefined,
    onRecalculate: () => undefined,
    onAdd: () => undefined,
    onCancel: () => undefined,
    onRetry: () => undefined,
    ...over,
  });

  it('comment, «+ позиція» and «Спробувати ще», no add button', () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    const onNewItem = vi.fn();
    render(
      <EstimateCard
        {...props({
          comment: 'Схоже, на фото немає їжі.',
          preview: 'data:image/jpeg;base64,AAAA',
          onRetry,
          onCancel,
          onNewItem,
        })}
      />,
    );
    expect(screen.getByText('Схоже, на фото немає їжі.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Додати/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Фото їжі' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(onNewItem).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('without a comment the advice fits text vs photo', () => {
    const { rerender } = render(<EstimateCard {...props({ photo: false })} />);
    expect(screen.getByText('Не вдалося знайти їжу в описі — спробуй сформулювати інакше.')).toBeTruthy();
    rerender(<EstimateCard {...props({ photo: true })} />);
    expect(screen.getByText('Не вдалося знайти їжу на фото — спробуй описати текстом.')).toBeTruthy();
  });

  it('the title can take focus (programmatically only) and still names the card', () => {
    const titleRef = createRef<HTMLSpanElement>();
    const phase = resultOf();
    render(<EstimateCard {...props({ drafts: phase.kind === 'result' ? phase.drafts : [], titleRef })} />);
    expect(screen.getByRole('region', { name: 'Оцінка калорій' })).toBeTruthy();
    expect(titleRef.current?.tabIndex).toBe(-1);
    titleRef.current?.focus();
    expect(document.activeElement).toBe(titleRef.current);
    expect(screen.getByRole('heading', { name: 'Оцінка калорій' }).contains(titleRef.current)).toBe(true);
  });
});

describe('EstimateLoading', () => {
  it('shows progress and can be cancelled (FoodAssist announces it)', () => {
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

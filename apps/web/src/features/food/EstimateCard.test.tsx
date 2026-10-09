import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useReducer, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftsToItems, type DraftItem } from './drafts';
import { EstimateCard, EstimateLoading, type EstimateCardProps } from './EstimateCard';
import { estimateReducer, IDLE, type EstimatePhase } from './estimate';

afterEach(cleanup);

const ITEMS = [
  { name: 'Борщ', portion: '300 г', kcal: 260 },
  { name: 'Хліб житній', portion: '2 скибки', kcal: 160 },
  { name: 'Сметана', portion: '', kcal: 60 },
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
  Pick<EstimateCardProps, 'remaining' | 'recalculating' | 'recalcError' | 'blockedHint'>
> & {
  onAdd?: (drafts: readonly DraftItem[]) => void;
  onRecalculate?: () => void;
  items?: typeof ITEMS;
};

/** Card wired to the estimate reducer, as FoodAssist does through `useFoodEstimate`. */
function Harness({
  onAdd = () => undefined,
  onRecalculate = () => undefined,
  items,
  remaining = 40,
  blockedHint,
  ...rest
}: HarnessProps) {
  const [phase, dispatch] = useReducer(estimateReducer, items, resultOf);
  const rowSeq = useRef(0);
  if (phase.kind !== 'result') return null;
  return (
    <>
      <EstimateCard
        drafts={phase.drafts}
        comment={phase.comment}
        preview={null}
        remaining={remaining}
        blockedHint={blockedHint}
        {...rest}
        onEdit={(itemId, field, value) => dispatch({ type: 'edit', itemId, field, value })}
        onAddItem={() => dispatch({ type: 'add', itemId: `n${++rowSeq.current}` })}
        onRemove={(itemId) => dispatch({ type: 'remove', itemId })}
        onRecalculate={onRecalculate}
        onAdd={() => onAdd(phase.drafts)}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />
      {/* FoodAssist's line under ✨/📷, unless the card's alert says the same. */}
      {blockedHint && blockedHint.text !== rest.recalcError && <p id={blockedHint.id}>{blockedHint.text}</p>}
    </>
  );
}

const OFFLINE = { id: 'blocked-hint', text: 'Потрібен інтернет' };
const LIMIT = 'Ліміт підрахунків на сьогодні вичерпано';

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const recalcButton = () =>
  screen.queryByRole('button', { name: /Перерахувати|Рахую…/ }) as HTMLButtonElement | null;
const addButton = () => screen.getByRole('button', { name: /^Додати \d+ ккал$/ }) as HTMLButtonElement;

describe('EstimateCard', () => {
  it('every row is editable: name, portion and kcal, with a live total', () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    expect(screen.getByRole('heading', { name: 'Оцінка калорій' })).toBeTruthy();
    expect(screen.getByText('3 позиції · можна виправити')).toBeTruthy();
    expect(screen.getByText('Порції оцінені приблизно.')).toBeTruthy();
    expect(addButton().textContent).toBe('Додати 480 ккал');

    expect(field('Назва позиції 1').value).toBe('Борщ');
    expect(field('Порція позиції 1').value).toBe('300 г');
    expect(field('Порція позиції 1').getAttribute('placeholder')).toBe('напр. 150 г');
    expect(field('Порція позиції 3').value).toBe('');

    const borsch = field('Калорії позиції 1');
    expect(borsch.value).toBe('260');
    expect(borsch.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(borsch, { target: { value: '31o' } });
    expect(borsch.value).toBe('31');
    fireEvent.change(borsch, { target: { value: '310' } });
    expect(addButton().textContent).toBe('Додати 530 ккал');

    fireEvent.click(screen.getByRole('button', { name: 'Прибрати «Сметана»' }));
    expect(screen.queryByDisplayValue('Сметана')).toBeNull();
    expect(screen.getByText('2 позиції · можна виправити')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Додати 470 ккал' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(draftsToItems(onAdd.mock.calls[0]![0] as DraftItem[])).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 310 },
      { name: 'Хліб житній', portion: '2 скибки', kcal: 160 },
    ]);
  });

  it('an emptied kcal field counts as 0', () => {
    render(<Harness />);
    fireEvent.change(field('Калорії позиції 1'), { target: { value: '' } });
    expect(addButton().textContent).toBe('Додати 220 ккал');
  });

  it('new grams of the same dish rescale kcal at once, without asking the model', () => {
    const onRecalculate = vi.fn();
    render(<Harness onRecalculate={onRecalculate} />);
    const portion = field('Порція позиції 1');
    fireEvent.change(portion, { target: { value: '450 г' } });
    expect(field('Калорії позиції 1').value).toBe('390');
    expect(screen.getByText('перераховано за вагою')).toBeTruthy();
    expect(field('Калорії позиції 1').getAttribute('aria-describedby')).toBe(
      screen.getByText('перераховано за вагою').id,
    );
    expect(addButton().textContent).toBe('Додати 610 ккал');
    expect(recalcButton()).toBeNull();
    expect(screen.queryByText('змінено')).toBeNull();

    // Back to the model's portion: back to its number, no note.
    fireEvent.change(portion, { target: { value: '300 г' } });
    expect(field('Калорії позиції 1').value).toBe('260');
    expect(screen.queryByText('перераховано за вагою')).toBeNull();
  });

  it('another dish or an amount the device cannot compare is marked «змінено» and offers «✨ Перерахувати»', () => {
    const onRecalculate = vi.fn();
    const onAdd = vi.fn();
    render(<Harness onRecalculate={onRecalculate} onAdd={onAdd} />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    expect(screen.getByText('змінено')).toBeTruthy();
    // Still the old number until the model answers.
    expect(field('Калорії позиції 2').value).toBe('160');

    const button = recalcButton();
    expect(button?.textContent).toBe('✨ Перерахувати');
    expect(button?.disabled).toBe(false);
    // Right above «Додати».
    expect(
      button && button.compareDocumentPosition(addButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перерахувати' }));
    expect(onRecalculate).toHaveBeenCalledOnce();

    // Not recalculated (no request running): «Додати» takes the numbers on screen and her name.
    fireEvent.click(addButton());
    expect(draftsToItems(onAdd.mock.calls[0]![0] as DraftItem[])[1]).toEqual({
      name: 'Хліб білий',
      portion: '2 скибки',
      kcal: 160,
    });

    fireEvent.change(field('Порція позиції 1'), { target: { value: '1 тарілка' } });
    expect(screen.getAllByText('змінено')).toHaveLength(2);
  });

  it('kcal she types herself pins the row: nothing left to recalculate', () => {
    render(<Harness />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    expect(recalcButton()).not.toBeNull();
    const kcal = field('Калорії позиції 2');
    kcal.focus();
    fireEvent.change(kcal, { target: { value: '190' } });
    expect(screen.queryByText('змінено')).toBeNull();
    expect(recalcButton()).toBeNull();
    // She is still typing there: the button going away does not move her.
    expect(document.activeElement).toBe(kcal);
    // A new name afterwards releases the pin.
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий тостовий' } });
    expect(screen.getByText('змінено')).toBeTruthy();
    expect(kcal.value).toBe('190');
  });

  it('«+ позиція» adds an empty row and puts her in its name', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(screen.getByText('4 позиції · можна виправити')).toBeTruthy();
    const name = field('Назва позиції 4');
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);
    // Nameless: no «змінено», no recalculation, not counted.
    expect(recalcButton()).toBeNull();
    fireEvent.change(field('Калорії позиції 4'), { target: { value: '50' } });
    expect(addButton().textContent).toBe('Додати 480 ккал');

    fireEvent.change(name, { target: { value: 'Чай' } });
    fireEvent.change(field('Порція позиції 4'), { target: { value: '1 чашка' } });
    expect(addButton().textContent).toBe('Додати 530 ккал');
    expect(screen.getByRole('button', { name: 'Прибрати «Чай»' })).toBeTruthy();
    // Named now, and described after her number: the model may price it.
    expect(screen.getByText('змінено')).toBeTruthy();
    expect(recalcButton()).not.toBeNull();
    // Her number typed last stands: nothing for the model.
    fireEvent.change(field('Калорії позиції 4'), { target: { value: '5' } });
    expect(recalcButton()).toBeNull();
    expect(addButton().textContent).toBe('Додати 485 ккал');
  });

  it('only nameless rows left: nothing to add', () => {
    render(<Harness items={[{ name: 'Борщ', portion: '300 г', kcal: 260 }]} />);
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати «Борщ»' }));
    expect(addButton().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Прибрати позицію 1' })).toBeTruthy();
  });

  it('a removed row hands focus to the next one', () => {
    render(<Harness />);
    const remove = screen.getByRole('button', { name: 'Прибрати «Борщ»' });
    remove.focus();
    fireEvent.click(remove);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Прибрати «Хліб житній»' }));
    screen.getByRole('button', { name: 'Прибрати «Сметана»' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати «Сметана»' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ позиція' }));
  });

  it('while recalculating: «Рахую…», still focusable, a second tap does nothing', () => {
    const onRecalculate = vi.fn();
    const { rerender } = render(<Harness onRecalculate={onRecalculate} />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    rerender(<Harness onRecalculate={onRecalculate} recalculating />);
    const button = recalcButton();
    expect(button?.textContent).toBe('Рахую…');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Рахую…' }));
    expect(onRecalculate).not.toHaveBeenCalled();
  });

  it('«Додати» waits for «Рахую…»: focusable, says what it waits for, a tap adds nothing', () => {
    const onAdd = vi.fn();
    const { rerender } = render(<Harness onAdd={onAdd} />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    rerender(<Harness onAdd={onAdd} recalculating />);
    const add = addButton();
    expect(add.disabled).toBe(false);
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe(recalcButton()?.id);
    add.focus();
    fireEvent.click(add);
    expect(onAdd).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(add);

    // The answer is in: «Додати» adds again.
    rerender(<Harness onAdd={onAdd} />);
    expect(addButton().hasAttribute('aria-disabled')).toBe(false);
    expect(addButton().hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(addButton());
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('«Рахую…» stays while the request runs, even when she undid the change; then focus moves on to «Додати»', () => {
    const { rerender } = render(<Harness />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    rerender(<Harness recalculating />);
    recalcButton()?.focus();
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб житній' } });
    expect(screen.queryByText('змінено')).toBeNull();
    // Otherwise «Додати» would wait for nothing she can see.
    expect(recalcButton()?.textContent).toBe('Рахую…');
    rerender(<Harness />);
    expect(recalcButton()).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it('offline or out of estimates: «Перерахувати» is locked, says why, and keeps her focus', () => {
    const onRecalculate = vi.fn();
    const { rerender } = render(<Harness onRecalculate={onRecalculate} />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    rerender(<Harness onRecalculate={onRecalculate} recalculating />);
    recalcButton()?.focus();
    // Locked under her focus as the request fails (a 429, or she went offline meanwhile).
    rerender(<Harness onRecalculate={onRecalculate} blockedHint={OFFLINE} />);
    const button = recalcButton();
    expect(button?.textContent).toBe('✨ Перерахувати');
    // Never natively disabled: that would drop her focus to <body>.
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.className).not.toMatch(/busy/);
    expect(button?.getAttribute('aria-describedby')).toBe('blocked-hint');
    expect(document.activeElement).toBe(button);
    fireEvent.click(screen.getByRole('button', { name: 'Перерахувати' }));
    expect(onRecalculate).not.toHaveBeenCalled();
    // «Додати» still adds what is on screen.
    expect(addButton().hasAttribute('aria-disabled')).toBe(false);
  });

  it('a failed recalculation is an inline alert (one line with the limit hint)', () => {
    const { rerender } = render(<Harness recalcError="Немає зʼєднання з сервером" />);
    expect(screen.getByRole('alert').textContent).toBe('Немає зʼєднання з сервером');
    expect(screen.getByRole('alert').hasAttribute('id')).toBe(false);
    rerender(<Harness remaining={0} recalcError={LIMIT} />);
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(LIMIT);
  });

  it('a 429 on «Перерахувати»: the alert becomes the blocked hint the buttons are described by', () => {
    const limit = { id: 'blocked-hint', text: LIMIT };
    render(<Harness remaining={0} recalcError={LIMIT} blockedHint={limit} />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('blocked-hint');
    expect(recalcButton()?.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('out of estimates: the card does not repeat the sheet’s «Ліміт…» line', () => {
    render(<Harness remaining={0} blockedHint={{ id: 'blocked-hint', text: LIMIT }} />);
    // The one line is FoodAssist's (here the harness's), under ✨/📷.
    expect(screen.getAllByText(LIMIT)).toHaveLength(1);
    expect(screen.getByText(LIMIT).id).toBe('blocked-hint');
  });

  it('when «Перерахувати» goes away under her focus, focus moves on to «Додати»', () => {
    render(<Harness />);
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб білий' } });
    recalcButton()?.focus();
    expect(document.activeElement).toBe(recalcButton());
    // Nothing waits for the model any more (as after a successful recalculation).
    fireEvent.change(field('Назва позиції 2'), { target: { value: 'Хліб житній' } });
    expect(recalcButton()).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it('shows the remaining budget only when it is low', () => {
    const { unmount } = render(<Harness remaining={40} />);
    expect(screen.queryByText(/Сьогодні ще/)).toBeNull();
    unmount();
    render(<Harness remaining={4} />);
    expect(screen.getByText('Сьогодні ще 4 підрахунки')).toBeTruthy();
  });

  it('nothing recognised: comment, «+ позиція» and «Спробувати ще», no add button', () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    const onAddItem = vi.fn();
    render(
      <EstimateCard
        drafts={[]}
        comment="Схоже, на фото немає їжі."
        preview="data:image/jpeg;base64,AAAA"
        remaining={null}
        onEdit={() => undefined}
        onAddItem={onAddItem}
        onRemove={() => undefined}
        onRecalculate={() => undefined}
        onAdd={() => undefined}
        onCancel={onCancel}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Схоже, на фото немає їжі.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Додати/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Фото їжі' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ позиція' }));
    expect(onAddItem).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('nothing recognised without a comment: the advice fits text vs photo', () => {
    const card = (photo: boolean) => (
      <EstimateCard
        drafts={[]}
        comment=""
        photo={photo}
        preview={null}
        remaining={null}
        onEdit={() => undefined}
        onAddItem={() => undefined}
        onRemove={() => undefined}
        onRecalculate={() => undefined}
        onAdd={() => undefined}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />
    );
    const { rerender } = render(card(false));
    expect(screen.getByText('Не вдалося знайти їжу в описі — спробуй сформулювати інакше.')).toBeTruthy();
    rerender(card(true));
    expect(screen.getByText('Не вдалося знайти їжу на фото — спробуй описати текстом.')).toBeTruthy();
  });

  it('the title can take focus (programmatically only) and still names the card', () => {
    const titleRef = createRef<HTMLSpanElement>();
    const phase = resultOf();
    render(
      <EstimateCard
        drafts={phase.kind === 'result' ? phase.drafts : []}
        comment=""
        preview={null}
        remaining={null}
        titleRef={titleRef}
        onEdit={() => undefined}
        onAddItem={() => undefined}
        onRemove={() => undefined}
        onRecalculate={() => undefined}
        onAdd={() => undefined}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />,
    );
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

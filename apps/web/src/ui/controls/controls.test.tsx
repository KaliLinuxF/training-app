import type { Weekday } from '@legko/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip';
import { Field } from './Field';
import { MeasureInputTile } from './MeasureInputTile';
import tileStyles from './MeasureInputTile.module.css';
import { NumberStepperField } from './NumberStepperField';
import { Segmented } from './Segmented';
import { Stepper } from './Stepper';
import { Switch } from './Switch';
import { TextArea } from './TextArea';
import { TrainingToggle } from './TrainingToggle';
import { toggleWeekday, WeekdayPicker } from './WeekdayPicker';

afterEach(cleanup);

describe('Switch', () => {
  it('exposes switch semantics and reports the next state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onChange={onChange} aria-label="Тренування" />);
    const sw = screen.getByRole('switch', { name: 'Тренування' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Switch checked onChange={onChange} aria-label="Тренування" />);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe('TrainingToggle', () => {
  it('marks the selected option with aria-pressed', () => {
    const { rerender } = render(<TrainingToggle value={null} onChange={() => undefined} />);
    const yes = screen.getByRole('button', { name: /Було/ });
    const no = screen.getByRole('button', { name: /Не було/ });
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    expect(no.getAttribute('aria-pressed')).toBe('false');

    rerender(<TrainingToggle value={true} onChange={() => undefined} />);
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    expect(no.getAttribute('aria-pressed')).toBe('false');

    rerender(<TrainingToggle value={false} onChange={() => undefined} />);
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    expect(no.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onChange with true / false, also when already selected', () => {
    const onChange = vi.fn();
    render(<TrainingToggle value={true} onChange={onChange} size="lg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    fireEvent.click(screen.getByRole('button', { name: 'Не було' }));
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('is labelled by the surrounding Field', () => {
    render(
      <Field label="Тренування дня">
        <TrainingToggle value={null} onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole('group', { name: 'Тренування дня' })).toBeTruthy();
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'week', label: 'Тиждень' },
    { value: 'month', label: 'Місяць' },
    { value: 'q', label: '3 міс.' },
    { value: 'all', label: 'Весь час' },
  ] as const;

  it('is a radio group with one checked option and a single tab stop', () => {
    render(<Segmented options={options} value="month" onChange={() => undefined} aria-label="Період" />);
    expect(screen.getByRole('radiogroup', { name: 'Період' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('selects on click and with arrow keys, never re-selecting the current value', () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="week" onChange={onChange} aria-label="Період" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Тиждень' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: '3 міс.' }));
    expect(onChange).toHaveBeenLastCalledWith('q');

    const week = screen.getByRole('radio', { name: 'Тиждень' });
    fireEvent.keyDown(week, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('month');
    fireEvent.keyDown(week, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(week, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('all');
  });
});

describe('MeasureInputTile', () => {
  it('draws a previous measurement darker than the plain «—» placeholder', () => {
    render(
      <>
        <MeasureInputTile label="Талія" value="" onChange={() => undefined} placeholder="73,5" />
        <MeasureInputTile label="Стегна" value="" onChange={() => undefined} />
      </>,
    );
    const waist = screen.getByRole('textbox', { name: /Талія/ });
    const hips = screen.getByRole('textbox', { name: /Стегна/ });
    expect(waist.getAttribute('placeholder')).toBe('73,5');
    expect(waist.classList.contains(tileStyles.previous ?? '')).toBe(true);
    expect(hips.getAttribute('placeholder')).toBe('—');
    expect(hips.classList.contains(tileStyles.previous ?? '')).toBe(false);
  });
});

describe('WeekdayPicker', () => {
  it('lists the days Monday first', () => {
    render(<WeekdayPicker mode="multi" value={[]} onChange={() => undefined} aria-label="Дні" />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Пн',
      'Вт',
      'Ср',
      'Чт',
      'Пт',
      'Сб',
      'Нд',
    ]);
    expect(screen.getByRole('button', { name: 'Понеділок' })).toBeTruthy();
  });

  it('toggles days in multi mode, keeping Monday-first order', () => {
    const onChange = vi.fn();
    render(<WeekdayPicker mode="multi" value={[0, 3]} onChange={onChange} aria-label="Дні" />);
    expect(screen.getByRole('button', { name: 'Неділя' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Понеділок' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Понеділок' }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 0]);
    fireEvent.click(screen.getByRole('button', { name: 'Середа' }));
    expect(onChange).toHaveBeenLastCalledWith([0]);
  });

  it('works as a radio group in single mode', () => {
    const onChange = vi.fn();
    render(<WeekdayPicker mode="single" value={1} onChange={onChange} aria-label="День зважування" />);
    expect(screen.getByRole('radiogroup', { name: 'День зважування' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Понеділок' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Пʼятниця' }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Понеділок' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('toggleWeekday adds and removes in calendar order', () => {
    const days: Weekday[] = [5, 1];
    expect(toggleWeekday(days, 3)).toEqual([1, 3, 5]);
    expect(toggleWeekday(days, 1)).toEqual([5]);
    expect(toggleWeekday([], 0)).toEqual([0]);
  });
});

describe('Chip', () => {
  it('reflects selection in aria-pressed', () => {
    const onClick = vi.fn();
    render(
      <Chip selected onClick={onClick}>
        Кардіо
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Кардіо' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Stepper', () => {
  it('calls the step callbacks and can disable a side', () => {
    const dec = vi.fn();
    const inc = vi.fn();
    render(
      <Stepper
        value="60,0 кг"
        onDecrement={dec}
        onIncrement={inc}
        canIncrement={false}
        aria-label="Цільова вага"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Зменшити' }));
    expect(dec).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Збільшити' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('group', { name: 'Цільова вага' }).textContent).toContain('60,0 кг');
  });
});

describe('NumberStepperField & TextArea', () => {
  it('are labelled by the Field and report raw text', () => {
    const onChange = vi.fn();
    const onNotes = vi.fn();
    const dec = vi.fn();
    render(
      <>
        <Field label="Калорії за день">
          <NumberStepperField
            value="1650"
            onChange={onChange}
            unit="ккал"
            inputMode="numeric"
            decrementText="−50"
            incrementText="+50"
            onDecrement={dec}
            onIncrement={() => undefined}
          />
        </Field>
        <Field label="Нотатки" hint="Самопочуття">
          <TextArea value="" onChange={onNotes} />
        </Field>
      </>,
    );
    const kcal = screen.getByRole('textbox', { name: 'Калорії за день' }) as HTMLInputElement;
    expect(kcal.inputMode).toBe('numeric');
    fireEvent.change(kcal, { target: { value: '1700' } });
    expect(onChange).toHaveBeenLastCalledWith('1700');
    fireEvent.click(screen.getByRole('button', { name: '−50' }));
    expect(dec).toHaveBeenCalledOnce();

    const notes = screen.getByRole('textbox', { name: 'Нотатки' });
    expect(notes.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.change(notes, { target: { value: 'Сон 8 год' } });
    expect(onNotes).toHaveBeenLastCalledWith('Сон 8 год');
  });
});

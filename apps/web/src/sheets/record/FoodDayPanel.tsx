import { useId } from 'react';
import { PhotoStrip } from '@/features/food';
import { Button, cx, Field, ListGroup, ListRow } from '@/ui';
import { DayNutritionCard } from './DayNutritionCard';
import {
  ADD_MEAL_LABEL,
  ADD_MEAL_TEXT,
  EMPTY_DAY_TEXT,
  EMPTY_FIELD_TEXT,
  MEALS_CAP_NOTE,
  MEALS_REGION,
  type FoodDayModel,
  type FoodDayRow,
} from './foodDayModel';
import s from './FoodDayPanel.module.css';

export interface FoodDayPanelProps {
  model: FoodDayModel;
  /**
   * `sheet` — the «Їжа» sheet body: totals card, the meal rows with their photos (its footer holds «+ Прийом їжі»);
   * `field` — the «Запис дня» food field: label «Їжа», the rows, the one-line total and an outline «+ Прийом їжі».
   */
  variant: 'sheet' | 'field';
  /** A meal row (its id) or «+ Прийом їжі» (null): the host opens the stacked meal editor inside the tap. */
  onOpenMeal: (mealId: string | null) => void;
}

/** The day's meals (docs/meals-macros.md §7.2, §7.5); every row opens that meal in the stacked editor. */
export function FoodDayPanel({ model, variant, onOpenMeal }: FoodDayPanelProps) {
  if (variant === 'sheet') {
    return (
      <div className={s.panel}>
        <DayNutritionCard totals={model.totals} />
        {model.rows.length > 0 ? (
          <ListGroup caption={MEALS_REGION} note={model.legacyNote ?? undefined}>
            {model.rows.map((row) => (
              <MealRow key={row.id} row={row} photos onOpen={() => onOpenMeal(row.id)} />
            ))}
          </ListGroup>
        ) : (
          <p className={s.empty}>{EMPTY_DAY_TEXT}</p>
        )}
      </div>
    );
  }
  return <FoodField model={model} onOpenMeal={onOpenMeal} />;
}

function FoodField({ model, onOpenMeal }: Omit<FoodDayPanelProps, 'variant'>) {
  return (
    <Field label="Їжа">
      {model.rows.length > 0 ? (
        <ListGroup aria-label={MEALS_REGION} flush note={model.legacyNote ?? undefined}>
          {model.rows.map((row) => (
            <MealRow key={row.id} row={row} onOpen={() => onOpenMeal(row.id)} />
          ))}
        </ListGroup>
      ) : (
        <p className={s.emptyField}>{EMPTY_FIELD_TEXT}</p>
      )}
      {model.totalLine && <p className={s.total}>{model.totalLine}</p>}
      <AddMealButton canAdd={model.canAdd} variant="outline" onAdd={() => onOpenMeal(null)} />
    </Field>
  );
}

interface MealRowProps {
  row: FoodDayRow;
  /** The «Їжа» sheet shows the meal's photos under its row (never inside the row's button). */
  photos?: boolean;
  onOpen: () => void;
}

/** «Сніданок · 08:30 … 420 ккал ›», then what she ate on one line and its Б · Ж · В. */
function MealRow({ row, photos = false, onOpen }: MealRowProps) {
  return (
    <ListRow
      title={
        <>
          {row.title}
          {row.time && <span className={s.time}> · {row.time}</span>}
        </>
      }
      sub={
        row.content || row.macros ? (
          <>
            {row.content && <span className={s.line}>{row.content}</span>}
            {row.content && row.macros && ' '}
            {row.macros && <span className={s.line}>{row.macros}</span>}
          </>
        ) : undefined
      }
      subWrap
      value={row.value}
      valueVariant={row.hasKcal ? 'strong' : 'soft'}
      aria-label={row.label}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {photos && row.photos.length > 0 && <PhotoStrip ids={row.photos} size="sm" />}
    </ListRow>
  );
}

export interface AddMealButtonProps {
  canAdd: boolean;
  /** `solid` lg in the «Їжа» footer, `outline` md in the «Запис дня» food field. */
  variant: 'solid' | 'outline';
  onAdd: () => void;
}

/**
 * «+ Прийом їжі» (name «Додати прийом їжі»). On a day with 20 meals it stays focusable but does nothing:
 * `aria-disabled` with the reason under it (D23).
 */
export function AddMealButton({ canAdd, variant, onAdd }: AddMealButtonProps) {
  const noteId = useId();
  const solid = variant === 'solid';
  return (
    <div className={s.add}>
      <Button
        variant={variant}
        size={solid ? 'lg' : 'md'}
        fullWidth
        className={cx(!canAdd && s.locked)}
        aria-label={ADD_MEAL_LABEL}
        aria-disabled={canAdd ? undefined : true}
        aria-describedby={canAdd ? undefined : noteId}
        onClick={canAdd ? onAdd : undefined}
      >
        {ADD_MEAL_TEXT}
      </Button>
      {!canAdd && (
        <p id={noteId} className={s.capNote}>
          {MEALS_CAP_NOTE}
        </p>
      )}
    </div>
  );
}

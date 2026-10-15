/**
 * The food feature: the meal editor «Прийом їжі» (docs/meals-macros.md §8.1) — its state hook, its body for a
 * host sheet and the stacked sheet — plus the photo diary and «Часті страви».
 */
export { MEAL_SHEET_HEADING, useMealEditor, type MealEditor } from './meal/useMealEditor';
export type { MealTarget } from './meal/mealModel';
export { MealEditorBody, type MealEditorBodyProps } from './meal/MealEditorBody';
export { MealSheet, type MealSheetProps } from './meal/MealSheet';
export { PhotoStrip, type PhotoStripProps } from './PhotoStrip';
export { PhotoViewer, type PhotoViewerProps } from './PhotoViewer';
export { FrequentDishes, type FrequentDishesProps } from './FrequentDishes';
// Kept for the record sheet's old food block until capture moves to the meal editor (§8.2).
export { formatFoodLine } from './model';
export type { FoodAdd } from './types';
export { insertEstimate, unestimatedTail } from './tail';

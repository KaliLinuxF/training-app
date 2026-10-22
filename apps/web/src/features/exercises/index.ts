/**
 * Exercise library (docs/workouts-steps-rebrand.md §2, §3.2–§3.4, §3.6 picker): the body map, the library and
 * exercise pages, the own-exercise editor and the picker used by the builder and the session.
 */
export { BodyMap, TAP_OUTLINE_MS, type BodyMapProps } from './BodyMap';
export { MuscleChips, type MuscleChipsProps } from './MuscleChips';
export { ExerciseThumb, ExerciseRow, type ExerciseThumbProps, type ExerciseRowProps } from './ExerciseRow';
export { ExercisePickerSheet, PICKER_HEADINGS, type ExercisePickerSheetProps } from './ExercisePickerSheet';
export { ExerciseEditorSheet, type ExerciseEditorSheetProps } from './ExerciseEditorSheet';
export { ExerciseLibraryScreen, type ExerciseLibraryScreenProps } from './ExerciseLibraryScreen';
export {
  ExerciseDetailScreen,
  ExerciseDetailPane,
  type ExerciseDetailScreenProps,
  type ExerciseDetailPaneProps,
} from './ExerciseDetailScreen';
export { ExerciseLibraryRoute } from './ExerciseLibraryRoute';
export {
  autoView,
  cycleMuscle,
  hitTest,
  mirror,
  muscleList,
  muscleSpeech,
  regionsFor,
  smoothPath,
  thumbViewBox,
  VIEWBOX,
  type BodyMapView,
  type MuscleState,
} from './bodyMapModel';
export {
  detailModel,
  exerciseLabel,
  exerciseSub,
  filterExercises,
  formatMetric,
  type ExerciseDetail,
  type LibraryFilter,
  type LibraryGroup,
} from './libraryModel';

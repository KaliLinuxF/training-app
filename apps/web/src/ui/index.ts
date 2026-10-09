/**
 * «Легко» UI kit — reusable pieces extracted from design/handoff/Tracker.dc.html (variant 1b).
 * See ./README.md for every component's props and the prototype element it reproduces.
 */

// Layout
export { ScreenHeader, type ScreenHeaderProps } from './layout/ScreenHeader';
export { ContentGrid, FullRow, fullRowClass } from './layout/ContentGrid';
export { Avatar, type AvatarProps } from './layout/Avatar';

// Surfaces
export { Card, type CardProps, type CardVariant, type CardGap } from './surfaces/Card';
export { CardHeader, type CardHeaderProps, type CardHeaderSize } from './surfaces/CardHeader';
export { Section, SectionTitle, type SectionProps, type SectionTitleProps } from './surfaces/Section';

// Tiles & rows
export { Tile, type TileProps, type TileVariant } from './tiles/Tile';
export { StatTile, type StatTileProps } from './tiles/StatTile';
export { KeyValueRow, type KeyValueRowProps, type KeyValueRowVariant } from './tiles/KeyValueRow';
export { DetailRow, type DetailRowProps } from './tiles/DetailRow';
export { BarRow, type BarRowProps, type BarRowVariant } from './tiles/BarRow';

// Controls
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './controls/Button';
export { IconButton, type IconButtonProps } from './controls/IconButton';
export { StepNav, type StepNavProps } from './controls/StepNav';
export { TrainingToggle, type TrainingToggleProps } from './controls/TrainingToggle';
export { Chip, ChipGroup, type ChipProps, type ChipGroupProps } from './controls/Chip';
export { Segmented, type SegmentedOption, type SegmentedProps } from './controls/Segmented';
export { Switch, type SwitchProps } from './controls/Switch';
export {
  WeekdayPicker,
  toggleWeekday,
  type WeekdayPickerProps,
  type WeekdayPickerMultiProps,
  type WeekdayPickerSingleProps,
} from './controls/WeekdayPicker';
export { Stepper, type StepperProps } from './controls/Stepper';
export { Field, useFieldA11y, type FieldProps } from './controls/Field';
export { NumberStepperField, type NumberStepperFieldProps } from './controls/NumberStepperField';
export { TextArea, type TextAreaProps } from './controls/TextArea';
export { TimeInput, type TimeInputProps } from './controls/TimeInput';
export { MeasureInputTile, type MeasureInputTileProps } from './controls/MeasureInputTile';
export { QuickAction, type QuickActionProps } from './controls/QuickAction';

// Feedback
export { Pill, type PillProps, type PillTone } from './feedback/Pill';
export { Banner, type BannerProps } from './feedback/Banner';
export { ProgressBar, type ProgressBarProps } from './feedback/ProgressBar';
export {
  Legend,
  LegendItem,
  type LegendProps,
  type LegendItemProps,
  type SwatchColor,
} from './feedback/Legend';
export { Toast } from './feedback/Toast';

// Charts
export {
  LineChart,
  type LineChartProps,
  type LineChartGeometry,
  type LineChartDot,
  type LineChartTag,
} from './charts/LineChart';
export { BarChart, type BarChartProps, type ChartBar, type BarTone } from './charts/BarChart';

// Sheet
export { Sheet, SHEET_EXIT_MS, type SheetProps, type SheetDateNav } from './sheet/Sheet';
export { useRetained } from './sheet/useRetained';

// Tones
export { deltaTone, type Tone } from './tone';

// Utilities
export { cx } from './internal/cx';
export { ConfirmHost } from './feedback/ConfirmDialog';

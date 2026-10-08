import type { ISODate } from '@legko/shared';
import { create } from 'zustand';

/**
 * - `day`     — full day record (training, food, kcal, optional weight & measurements, notes)
 * - `weight`  — control weigh-in only
 * - `measure` — body measurements only
 * - `setup`   — first-run setup (start weight, goal, calorie goal)
 * - `install` — how to add the app to the iPhone home screen (needed for push)
 */
export type SheetMode = 'day' | 'weight' | 'measure' | 'setup' | 'install';

/** Pre-filled draft values when opening the day sheet (e.g. «✓ Було» on Home). */
export interface SheetPatch {
  trained?: boolean;
}

export interface SheetState {
  mode: SheetMode;
  date: ISODate;
  patch?: SheetPatch;
  /** Changes on every open so the sheet re-initialises its draft. */
  key: number;
}

export interface ToastState {
  text: string;
  key: number;
}

interface UiStore {
  sheet: SheetState | null;
  toast: ToastState | null;
}

export const useUiStore = create<UiStore>(() => ({ sheet: null, toast: null }));

export const useSheet = (): SheetState | null => useUiStore((s) => s.sheet);
export const useToast = (): ToastState | null => useUiStore((s) => s.toast);

let seq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const ui = {
  openSheet(date: ISODate, mode: SheetMode, patch?: SheetPatch): void {
    useUiStore.setState({ sheet: { mode, date, patch, key: ++seq } });
  },
  closeSheet(): void {
    useUiStore.setState({ sheet: null });
  },
  /** Short confirmation pill at the top of the screen («Збережено»). */
  flash(text: string, ms = 1800): void {
    clearTimeout(toastTimer);
    useUiStore.setState({ toast: { text, key: ++seq } });
    toastTimer = setTimeout(() => useUiStore.setState({ toast: null }), ms);
  },
};

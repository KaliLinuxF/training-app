import type { ISODate } from '@legko/shared';
import { create } from 'zustand';

/**
 * - `menu`    — «Що записати?»: four actions for the date (Їжа, Тренування, Вага, Заміри), opened by «+»
 * - `day`     — the full «Запис дня» (training, food, kcal, weight, measurements, notes): calendar, history,
 *               «Відкрити день»
 * - `food`    — «Їжа»: food text, photos, FoodAssist, kcal
 * - `workout` — «Тренування»: ✓/✕, types, optional notes
 * - `weight`  — «Контрольне зважування»
 * - `measure` — «Заміри тіла»
 * - `setup`   — «Перші кроки» (first run: start weight, goal, calorie goal)
 * - `install` — «Встановлення на iPhone» (adding the app to the home screen, needed for push)
 */
export type SheetMode = 'menu' | 'day' | 'food' | 'workout' | 'weight' | 'measure' | 'setup' | 'install';

/** Pre-filled draft values: `trained` pre-fills the `workout` and `day` sheets (the workout push deep link). */
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

/** An in-app confirmation (replaces `window.confirm`, which looks foreign in the standalone iPhone app). */
export interface ConfirmOptions {
  title: string;
  /** Optional explanation under the title. */
  body?: string;
  /** Default «Так». */
  confirmLabel?: string;
  /** Default «Скасувати». */
  cancelLabel?: string;
  /** Destructive actions get initial focus on «cancel» and a stronger confirm button. */
  destructive?: boolean;
}

export interface ConfirmState extends ConfirmOptions {
  key: number;
  resolve: (ok: boolean) => void;
}

interface UiStore {
  sheet: SheetState | null;
  toast: ToastState | null;
  confirm: ConfirmState | null;
}

export const useUiStore = create<UiStore>(() => ({ sheet: null, toast: null, confirm: null }));
export const useConfirm = (): ConfirmState | null => useUiStore((s) => s.confirm);

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
  /**
   * Asks a yes/no question in the app's own dialog (rendered once by the shell above sheets).
   * Resolves `true` on confirm, `false` on cancel / Escape / backdrop. A newer request cancels an open one.
   */
  confirm(options: ConfirmOptions): Promise<boolean> {
    useUiStore.getState().confirm?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const key = ++seq;
      const settle = (ok: boolean) => {
        if (useUiStore.getState().confirm?.key === key) useUiStore.setState({ confirm: null });
        resolve(ok);
      };
      useUiStore.setState({ confirm: { ...options, key, resolve: settle } });
    });
  },
  /** Short confirmation pill at the top of the screen («Збережено»). */
  flash(text: string, ms = 1800): void {
    clearTimeout(toastTimer);
    useUiStore.setState({ toast: { text, key: ++seq } });
    toastTimer = setTimeout(() => useUiStore.setState({ toast: null }), ms);
  },
};

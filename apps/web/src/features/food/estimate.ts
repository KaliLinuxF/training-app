/**
 * Estimate flow state: idle → loading (photo being prepared / request in flight) → result.
 * The reducer is pure; `useFoodEstimate` runs the requests and feeds it.
 */
import type { FoodEstimateResponse, ISODate } from '@legko/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/store/ui';
import { estimateErrorMessage, isAbort } from './errors';
import { noteEstimateUsed, noteRateLimited } from './foodStatus';
import { preparePhoto, type PhotoDeps } from './image';
import { estimateItems, sanitizeKcalInput, toDrafts, type DraftItem } from './model';

export type EstimatePhase =
  | { kind: 'idle' }
  | { kind: 'loading'; id: number; photo: boolean; preview: string | null }
  | {
      kind: 'result';
      id: number;
      preview: string | null;
      photoId: string | null;
      drafts: DraftItem[];
      comment: string;
    };

export type EstimateAction =
  | { type: 'start'; id: number; photo: boolean }
  | { type: 'preview'; id: number; preview: string }
  | { type: 'resolve'; id: number; res: FoodEstimateResponse }
  | { type: 'fail'; id: number }
  | { type: 'edit'; itemId: string; kcalText: string }
  | { type: 'remove'; itemId: string }
  | { type: 'reset' };

export const IDLE: EstimatePhase = { kind: 'idle' };

/** Late answers of a cancelled or replaced request (different `id`) are ignored. */
export function estimateReducer(state: EstimatePhase, action: EstimateAction): EstimatePhase {
  switch (action.type) {
    case 'start':
      return { kind: 'loading', id: action.id, photo: action.photo, preview: null };
    case 'preview':
      return state.kind === 'loading' && state.id === action.id ? { ...state, preview: action.preview } : state;
    case 'resolve':
      if (state.kind !== 'loading' || state.id !== action.id) return state;
      return {
        kind: 'result',
        id: action.id,
        preview: state.preview,
        photoId: action.res.photoId ?? null,
        drafts: toDrafts(estimateItems(action.res)),
        comment: action.res.comment.trim(),
      };
    case 'fail':
      return state.kind === 'loading' && state.id === action.id ? IDLE : state;
    case 'edit':
      if (state.kind !== 'result') return state;
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.itemId ? { ...d, kcalText: sanitizeKcalInput(action.kcalText) } : d,
        ),
      };
    case 'remove':
      if (state.kind !== 'result') return state;
      return { ...state, drafts: state.drafts.filter((d) => d.id !== action.itemId) };
    case 'reset':
      return IDLE;
  }
}

export interface FoodEstimateApi {
  phase: EstimatePhase;
  /** Estimates a text description. */
  fromText: (text: string) => void;
  /** Prepares the photo on the device and estimates it (with the optional text as a hint). */
  fromPhoto: (file: File, hint: string) => void;
  editKcal: (itemId: string, kcalText: string) => void;
  removeItem: (itemId: string) => void;
  /** Cancels a running request (its answer is ignored) or dismisses the result. */
  reset: () => void;
}

export interface EstimateDeps {
  estimate: typeof api.foodEstimate;
  photo?: PhotoDeps;
  /** Where error messages go (the app toast by default). */
  notify: (text: string) => void;
}

const defaultDeps: EstimateDeps = { estimate: api.foodEstimate, notify: (text) => ui.flash(text, 2600) };

export function useFoodEstimate(date: ISODate, deps: EstimateDeps = defaultDeps): FoodEstimateApi {
  const [phase, dispatch] = useReducer(estimateReducer, IDLE);
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  // Closing the sheet mid-request: drop the request.
  useEffect(() => abort, [abort]);

  const run = useCallback(
    (photo: boolean, build: (id: number, signal: AbortSignal) => Promise<FoodEstimateResponse>) => {
      abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const id = ++seq.current;
      dispatch({ type: 'start', id, photo });
      build(id, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          noteEstimateUsed();
          dispatch({ type: 'resolve', id, res });
        })
        .catch((err: unknown) => {
          if (isAbort(err, ctrl.signal)) return;
          dispatch({ type: 'fail', id });
          if (err instanceof ApiError && err.code === 'rate_limited') noteRateLimited();
          depsRef.current.notify(estimateErrorMessage(err));
        })
        .finally(() => {
          if (controller.current === ctrl) controller.current = null;
        });
    },
    [abort],
  );

  const fromText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      run(false, (_id, signal) => depsRef.current.estimate({ date, text: t }, signal));
    },
    [date, run],
  );

  const fromPhoto = useCallback(
    (file: File, hint: string) => {
      run(true, async (id, signal) => {
        const photo = await preparePhoto(file, depsRef.current.photo);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        dispatch({ type: 'preview', id, preview: photo.previewUrl });
        const text = hint.trim();
        return depsRef.current.estimate(
          { date, ...(text ? { text } : {}), image: { full: photo.full, thumb: photo.thumb } },
          signal,
        );
      });
    },
    [date, run],
  );

  const reset = useCallback(() => {
    abort();
    dispatch({ type: 'reset' });
  }, [abort]);

  const editKcal = useCallback((itemId: string, kcalText: string) => dispatch({ type: 'edit', itemId, kcalText }), []);
  const removeItem = useCallback((itemId: string) => dispatch({ type: 'remove', itemId }), []);

  return { phase, fromText, fromPhoto, editKcal, removeItem, reset };
}

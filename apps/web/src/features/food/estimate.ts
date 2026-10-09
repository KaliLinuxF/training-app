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
import { draftsTotal, estimateItems, sanitizeKcalInput, toDrafts, type DraftItem } from './model';

export type EstimatePhase =
  /** `error`: why the last attempt failed (shown inline until the next attempt or reset). */
  | { kind: 'idle'; error?: string }
  | {
      kind: 'loading';
      id: number;
      photo: boolean;
      /** The «Що я їла» tail this text estimate replaces on «Додати» ('' → append). */
      consumed: string;
      preview: string | null;
    }
  | {
      kind: 'result';
      id: number;
      photo: boolean;
      consumed: string;
      preview: string | null;
      photoId: string | null;
      drafts: DraftItem[];
      comment: string;
      /** What the model found, before any edits (announced once). */
      found: { count: number; total: number };
    };

export type EstimateAction =
  | { type: 'start'; id: number; photo: boolean; consumed: string }
  | { type: 'preview'; id: number; preview: string }
  | { type: 'resolve'; id: number; res: FoodEstimateResponse }
  | { type: 'fail'; id: number; message: string }
  | { type: 'edit'; itemId: string; kcalText: string }
  | { type: 'remove'; itemId: string }
  | { type: 'reset' };

export const IDLE: EstimatePhase = { kind: 'idle' };

/** Late answers of a cancelled or replaced request (different `id`) are ignored. */
export function estimateReducer(state: EstimatePhase, action: EstimateAction): EstimatePhase {
  switch (action.type) {
    case 'start':
      return { kind: 'loading', id: action.id, photo: action.photo, consumed: action.consumed, preview: null };
    case 'preview':
      return state.kind === 'loading' && state.id === action.id ? { ...state, preview: action.preview } : state;
    case 'resolve': {
      if (state.kind !== 'loading' || state.id !== action.id) return state;
      const drafts = toDrafts(estimateItems(action.res));
      return {
        kind: 'result',
        id: action.id,
        photo: state.photo,
        consumed: state.consumed,
        preview: state.preview,
        photoId: action.res.photoId ?? null,
        drafts,
        comment: action.res.comment.trim(),
        found: { count: drafts.length, total: draftsTotal(drafts) },
      };
    }
    case 'fail':
      return state.kind === 'loading' && state.id === action.id ? { kind: 'idle', error: action.message } : state;
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
  /**
   * Estimates a text description. `consumed` is the «Що я їла» tail the text was pre-filled from
   * when she left it unchanged (the result then replaces that tail), else ''.
   */
  fromText: (text: string, consumed?: string) => void;
  /** Prepares the photo on the device and estimates it (with the optional text as a hint). */
  fromPhoto: (file: File, hint: string) => void;
  editKcal: (itemId: string, kcalText: string) => void;
  removeItem: (itemId: string) => void;
  /** Cancels a running request (its answer is ignored), dismisses the result or the last error. */
  reset: () => void;
}

export interface EstimateDeps {
  estimate: typeof api.foodEstimate;
  photo?: PhotoDeps;
  /** Where error messages go besides the inline alert (the app toast by default). */
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
    (
      photo: boolean,
      consumed: string,
      build: (id: number, signal: AbortSignal) => Promise<FoodEstimateResponse>,
    ) => {
      abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const id = ++seq.current;
      dispatch({ type: 'start', id, photo, consumed });
      build(id, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          noteEstimateUsed();
          dispatch({ type: 'resolve', id, res });
        })
        .catch((err: unknown) => {
          if (isAbort(err, ctrl.signal)) return;
          const message = estimateErrorMessage(err, photo ? 'photo' : 'text');
          dispatch({ type: 'fail', id, message });
          if (err instanceof ApiError && err.code === 'rate_limited') noteRateLimited();
          depsRef.current.notify(message);
        })
        .finally(() => {
          if (controller.current === ctrl) controller.current = null;
        });
    },
    [abort],
  );

  const fromText = useCallback(
    (text: string, consumed = '') => {
      const t = text.trim();
      if (!t) return;
      run(false, consumed, (_id, signal) => depsRef.current.estimate({ date, text: t }, signal));
    },
    [date, run],
  );

  const fromPhoto = useCallback(
    (file: File, hint: string) => {
      // A photo line is always appended: the photo is not the text she typed.
      run(true, '', async (id, signal) => {
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

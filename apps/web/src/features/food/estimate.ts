/**
 * Estimate flow state: idle → loading (photo being prepared / request in flight) → result, where
 * she edits the rows and may send her corrections back once («✨ Перерахувати»).
 * The reducer is pure; `useFoodEstimate` runs the requests and feeds it.
 */
import type { FoodEstimateRequest, FoodEstimateResponse, ISODate } from '@legko/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/store/ui';
import {
  applyRecalc,
  draftsTotal,
  editDraft,
  emptyDraft,
  MAX_ROWS,
  recalcRows,
  toDrafts,
  type DraftField,
  type DraftItem,
  type RecalcRow,
} from './drafts';
import { estimateErrorMessage, isAbort, isPhotoGone, type EstimateSource } from './errors';
import { noteEstimateUsed, noteRateLimited } from './foodStatus';
import { preparePhoto, type PhotoDeps } from './image';
import { estimateItems } from './model';

/** «✨ Перерахувати» inside a result. */
export interface RecalcState {
  /** Id of the recalculation in flight (answers of another id are ignored), else null. */
  pending: number | null;
  /** Why the last one failed (inline alert in the card until the next attempt). */
  error?: string;
  /** The last one that succeeded, with the new total (announced once). */
  done?: { id: number; total: number };
}

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
      recalc: RecalcState;
    };

export type EstimateAction =
  | { type: 'start'; id: number; photo: boolean; consumed: string }
  | { type: 'preview'; id: number; preview: string }
  | { type: 'resolve'; id: number; res: FoodEstimateResponse }
  | { type: 'fail'; id: number; message: string }
  | { type: 'edit'; itemId: string; field: DraftField; value: string }
  | { type: 'add'; itemId: string }
  | { type: 'remove'; itemId: string }
  | { type: 'recalcStart'; id: number }
  /** `rows`: what was sent, in order (the answer lists the same items). */
  | { type: 'recalcResolve'; id: number; rows: RecalcRow[]; res: FoodEstimateResponse }
  | { type: 'recalcFail'; id: number; message: string }
  /** The photo recalculation `id` sent for context is gone from the server (see `isPhotoGone`). */
  | { type: 'photoGone'; id: number }
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
        recalc: { pending: null },
      };
    }
    case 'fail':
      return state.kind === 'loading' && state.id === action.id ? { kind: 'idle', error: action.message } : state;
    case 'edit':
      return withDrafts(state, (ds) =>
        ds.map((d) => (d.id === action.itemId ? editDraft(d, action.field, action.value) : d)),
      );
    case 'add':
      return withDrafts(state, (ds) => (ds.length < MAX_ROWS ? [...ds, emptyDraft(action.itemId)] : ds));
    case 'remove':
      return withDrafts(state, (ds) => ds.filter((d) => d.id !== action.itemId));
    case 'recalcStart':
      return state.kind === 'result' ? { ...state, recalc: { pending: action.id } } : state;
    case 'recalcResolve': {
      if (state.kind !== 'result' || state.recalc.pending !== action.id) return state;
      const drafts = applyRecalc(state.drafts, action.rows, action.res.items);
      return {
        ...state,
        drafts,
        // The model's remark on her corrected meal replaces the one on its first guess.
        comment: action.res.comment.trim() || state.comment,
        recalc: { pending: null, done: { id: action.id, total: draftsTotal(drafts) } },
      };
    }
    case 'recalcFail':
      return state.kind === 'result' && state.recalc.pending === action.id
        ? { ...state, recalc: { pending: null, error: action.message } }
        : state;
    case 'photoGone':
      // Neither sent again nor added with the day: there is nothing left to show.
      return state.kind === 'result' && state.recalc.pending === action.id ? { ...state, photoId: null } : state;
    case 'reset':
      return IDLE;
  }
}

/** Row edits only apply to a result on screen. */
function withDrafts(state: EstimatePhase, update: (drafts: DraftItem[]) => DraftItem[]): EstimatePhase {
  return state.kind === 'result' ? { ...state, drafts: update(state.drafts) } : state;
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
  editItem: (itemId: string, field: DraftField, value: string) => void;
  /** Appends an empty row («+ позиція»). */
  addItem: () => void;
  removeItem: (itemId: string) => void;
  /**
   * «✨ Перерахувати»: sends all named rows (her names and portions) with the photo for context;
   * the rows marked «змінено» take the new kcal. No-op when nothing needs it or one is running.
   * A photo the server no longer has is dropped, and the rows are priced without it.
   */
  recalculate: () => void;
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

interface Send {
  /** Picks the advice when it fails. */
  source: EstimateSource;
  start: (id: number) => EstimateAction;
  call: (id: number, signal: AbortSignal) => Promise<FoodEstimateResponse>;
  /** May throw: the answer is then treated as a failure. */
  resolve: (id: number, res: FoodEstimateResponse) => EstimateAction;
  fail: (id: number, message: string) => EstimateAction;
}

export function useFoodEstimate(date: ISODate, deps: EstimateDeps = defaultDeps): FoodEstimateApi {
  const [phase, dispatch] = useReducer(estimateReducer, IDLE);
  const seq = useRef(0);
  const rowSeq = useRef(0);
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

  /** One request at a time: a new one aborts the previous; aborted answers are dropped. */
  const send = useCallback(
    ({ source, start, call, resolve, fail }: Send) => {
      abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const id = ++seq.current;
      dispatch(start(id));
      call(id, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          noteEstimateUsed();
          dispatch(resolve(id, res));
        })
        .catch((err: unknown) => {
          if (isAbort(err, ctrl.signal)) return;
          const message = estimateErrorMessage(err, source);
          dispatch(fail(id, message));
          if (err instanceof ApiError && err.code === 'rate_limited') noteRateLimited();
          depsRef.current.notify(message);
        })
        .finally(() => {
          if (controller.current === ctrl) controller.current = null;
        });
    },
    [abort],
  );

  const estimateFrom = useCallback(
    (photo: boolean, consumed: string, call: Send['call']) =>
      send({
        source: photo ? 'photo' : 'text',
        start: (id) => ({ type: 'start', id, photo, consumed }),
        call,
        resolve: (id, res) => ({ type: 'resolve', id, res }),
        fail: (id, message) => ({ type: 'fail', id, message }),
      }),
    [send],
  );

  const fromText = useCallback(
    (text: string, consumed = '') => {
      const t = text.trim();
      if (!t) return;
      estimateFrom(false, consumed, (_id, signal) => depsRef.current.estimate({ date, text: t }, signal));
    },
    [date, estimateFrom],
  );

  const fromPhoto = useCallback(
    (file: File, hint: string) => {
      // A photo line is always appended: the photo is not the text she typed.
      estimateFrom(true, '', async (id, signal) => {
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
    [date, estimateFrom],
  );

  const recalculate = useCallback(() => {
    if (phase.kind !== 'result' || phase.recalc.pending !== null) return;
    const rows = recalcRows(phase.drafts);
    if (!rows) return;
    const { photoId } = phase;
    const request = (withPhoto: boolean): FoodEstimateRequest => ({
      date,
      items: rows.map(({ name, portion }) => ({ name, portion })),
      // The stored photo gives the model context; it is not stored again.
      ...(withPhoto && photoId ? { photoId } : {}),
    });
    send({
      source: 'recalc',
      start: (id) => ({ type: 'recalcStart', id }),
      call: async (id, signal) => {
        const { estimate } = depsRef.current;
        if (!photoId) return estimate(request(false), signal);
        try {
          return await estimate(request(true), signal);
        } catch (err) {
          if (signal.aborted || !isPhotoGone(err)) throw err;
          // Cleaned up while the card stayed open: the photo was only context, and every retry
          // with it would fail the same way. Her rows are priced without it (the 404 cost nothing).
          dispatch({ type: 'photoGone', id });
          return estimate(request(false), signal);
        }
      },
      resolve: (id, res) => {
        if (res.items.length !== rows.length) throw new Error('The recalculation answered for other items');
        return { type: 'recalcResolve', id, rows, res };
      },
      fail: (id, message) => ({ type: 'recalcFail', id, message }),
    });
  }, [date, phase, send]);

  const reset = useCallback(() => {
    abort();
    dispatch({ type: 'reset' });
  }, [abort]);

  const editItem = useCallback(
    (itemId: string, field: DraftField, value: string) => dispatch({ type: 'edit', itemId, field, value }),
    [],
  );
  const addItem = useCallback(() => dispatch({ type: 'add', itemId: `n${++rowSeq.current}` }), []);
  const removeItem = useCallback((itemId: string) => dispatch({ type: 'remove', itemId }), []);

  return { phase, fromText, fromPhoto, editItem, addItem, removeItem, recalculate, reset };
}

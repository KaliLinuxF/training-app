/**
 * Estimate flow state: idle → loading (photo being prepared / request in flight) → result, where
 * she corrects the rows one at a time in the item editor (a local draft of one row, applied on
 * «Готово») and may send her corrections back («✨ Перерахувати»).
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
  needsRecalc,
  putDraft,
  rebaseDraft,
  recalcRows,
  sameDraft,
  toDrafts,
  type DraftField,
  type DraftItem,
  type RecalcRow,
} from './drafts';
import { estimateErrorMessage, isAbort, isPhotoGone, type EstimateSource } from './errors';
import { noteEstimateUsed, noteRateLimited } from './foodStatus';
import { preparePhoto, type PhotoDeps } from './image';
import {
  canSave,
  editorReducer,
  newEditor,
  openEditor,
  type EditorAction,
  type ItemEditorState,
} from './itemEditorModel';
import { estimateItems } from './model';

/** «✨ Перерахувати» inside a result. */
export interface RecalcState {
  /** Id of the recalculation in flight (answers of another id are ignored), else null. */
  pending: number | null;
  /**
   * The last one was asked for in the item editor, and its outcome belongs there: «Рахую…» and a
   * failure show in the editor, the answer is not announced (the editor's kcal number says it).
   * On «Готово» it becomes the card's; on ✕ what it said about the dropped draft goes too.
   */
  fromEditor?: boolean;
  /** Why the last one failed (inline alert in the card and the editor until the next attempt). */
  error?: string;
  /**
   * The last one that succeeded, with the new total (announced once). One asked for in the item
   * editor is not announced: the editor's kcal number says it, the card's total once she applies it.
   */
  done?: { id: number; total: number; fromEditor?: boolean };
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
      /** The item editor, when open: one row's local draft (not in `drafts` until saved). */
      editor: ItemEditorState | null;
    };

export type EstimateAction =
  | { type: 'start'; id: number; photo: boolean; consumed: string }
  | { type: 'preview'; id: number; preview: string }
  | { type: 'resolve'; id: number; res: FoodEstimateResponse }
  | { type: 'fail'; id: number; message: string }
  /** One field of a row, straight in the list (the editor applies its draft with `saveItem`). */
  | { type: 'edit'; itemId: string; field: DraftField; value: string }
  /** An empty row in the list. */
  | { type: 'add'; itemId: string }
  /** Removes a row (and closes the editor on it). */
  | { type: 'remove'; itemId: string }
  /** The item editor on a row of the list. */
  | { type: 'openItem'; itemId: string }
  /** The item editor on a new row («+ позиція»), up to `MAX_ROWS`. */
  | { type: 'newItem'; itemId: string }
  /** A change in the open editor's draft. */
  | { type: 'editor'; action: EditorAction }
  /** «Готово» / «Додати позицію»: the draft replaces its row (or joins the list) and the editor closes. */
  | { type: 'saveItem' }
  /** ✕ / Escape / backdrop: the draft is dropped. */
  | { type: 'closeItem' }
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
        editor: null,
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
    case 'remove': {
      if (state.kind !== 'result') return state;
      const drafts = state.drafts.filter((d) => d.id !== action.itemId);
      // «Видалити позицію»: the editor goes with its row, like a dropped draft.
      if (state.editor?.item.id === action.itemId) {
        return { ...state, drafts, editor: null, recalc: dropEditorOutcome(state.recalc) };
      }
      return { ...state, drafts };
    }
    case 'openItem': {
      if (state.kind !== 'result') return state;
      const row = state.drafts.find((d) => d.id === action.itemId);
      return row ? { ...state, editor: openEditor(row), recalc: toCard(state.recalc) } : state;
    }
    case 'newItem':
      return state.kind === 'result' && state.drafts.length < MAX_ROWS
        ? { ...state, editor: newEditor(action.itemId), recalc: toCard(state.recalc) }
        : state;
    case 'editor':
      return state.kind === 'result' && state.editor
        ? { ...state, editor: editorReducer(state.editor, action.action) }
        : state;
    case 'saveItem': {
      if (state.kind !== 'result' || !state.editor || !canSave(state.editor)) return state;
      const editor = state.editor;
      return {
        ...state,
        drafts: putDraft(state.drafts, editor.item),
        // The model's remark on her draft comes with it.
        comment: editor.comment ?? state.comment,
        // Her draft is in the list now: a recalculation still running, or failed, is the card's.
        recalc: toCard(state.recalc),
        editor: null,
      };
    }
    case 'closeItem':
      return state.kind === 'result' && state.editor
        ? { ...state, editor: null, recalc: dropEditorOutcome(state.recalc) }
        : state;
    case 'recalcStart':
      return state.kind === 'result'
        ? { ...state, recalc: { pending: action.id, ...(state.editor ? { fromEditor: true } : {}) } }
        : state;
    case 'recalcResolve': {
      if (state.kind !== 'result' || state.recalc.pending !== action.id) return state;
      const { rows, res } = action;
      const drafts = applyRecalc(state.drafts, rows, res.items);
      const editor = state.editor && rebaseEditor(state.editor, state.drafts, drafts, rows, res);
      const fromEditor = state.recalc.fromEditor === true;
      const remark = res.comment.trim();
      // The model's remark on her corrected meal replaces the one on its first guess, where the
      // answer was taken: asked for in the editor and taken by its draft, it is about that draft and
      // waits there; otherwise in the card when a row in the list took it (not when she has changed
      // them all meanwhile, or dropped the editor that asked).
      const remarkInEditor = fromEditor && editor !== null && editor !== state.editor;
      const tookIt = drafts.some((d, i) => d !== state.drafts[i]);
      return {
        ...state,
        drafts,
        editor: remarkInEditor && remark ? { ...editor, comment: remark } : editor,
        comment: !remarkInEditor && tookIt && remark ? remark : state.comment,
        recalc: {
          pending: null,
          done: { id: action.id, total: draftsTotal(drafts), ...(fromEditor ? { fromEditor: true } : {}) },
        },
      };
    }
    case 'recalcFail': {
      if (state.kind !== 'result' || state.recalc.pending !== action.id) return state;
      if (!state.recalc.fromEditor) return { ...state, recalc: { pending: null, error: action.message } };
      // Asked for in the editor: its alert says why. Unless she has dropped that editor and nothing
      // in the list waits for the model: then it was about nothing that is still there.
      const orphan = state.editor === null && !state.drafts.some(needsRecalc);
      return {
        ...state,
        recalc: orphan
          ? { pending: null, fromEditor: true }
          : { pending: null, error: action.message, fromEditor: true },
      };
    }
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

/**
 * The editor's recalculation becomes the card's (her draft joined the list, or another editor
 * opened after she dropped the one that asked): «Рахую…» and a failure show in the card, and an
 * answer still to come is announced with the new total. One already answered stays unannounced.
 */
function toCard(recalc: RecalcState): RecalcState {
  if (!recalc.fromEditor || (recalc.pending === null && recalc.error === undefined)) return recalc;
  const { fromEditor: _fromEditor, ...rest } = recalc;
  return rest;
}

/**
 * The editor is closed without its draft (✕, or its row deleted): a failure of its recalculation
 * was about that draft and goes with it. `fromEditor` stays, so nothing is announced instead
 * (in particular not the first estimate's «Знайдено…» again). One still running carries on: it
 * prices the rest of the list too (see 'recalcResolve' / 'recalcFail').
 */
function dropEditorOutcome(recalc: RecalcState): RecalcState {
  if (!recalc.fromEditor || recalc.pending !== null || recalc.error === undefined) return recalc;
  const { error: _error, ...rest } = recalc;
  return rest;
}

/**
 * The open editor after a recalculation answer (`before` / `after`: the list without and with it).
 * - Its draft takes the answer when it is exactly what was sent (asked for in the editor).
 * - When its row in the list took the answer (the card's «Перерахувати», with the editor opened on
 *   that row meanwhile), the row as priced is what the editor started from: an untouched draft
 *   becomes it (✕ then has nothing to ask about); a changed one keeps her changes on top of the
 *   model's new numbers, rescaled on the device where it can (one more piece of the priced dish),
 *   so «Готово» neither loses the answer nor asks for another paid one.
 */
function rebaseEditor(
  editor: ItemEditorState,
  before: readonly DraftItem[],
  after: readonly DraftItem[],
  rows: readonly RecalcRow[],
  res: FoodEstimateResponse,
): ItemEditorState {
  const priced = applyRecalc([editor.item], rows, res.items)[0] ?? editor.item;
  const { original } = editor;
  const id = editor.item.id;
  const row = after.find((d) => d.id === id);
  const rowTookIt = row !== undefined && row !== before.find((d) => d.id === id);
  if (!original || !row || !rowTookIt || row.base === null) {
    return priced === editor.item ? editor : { ...editor, item: priced };
  }
  let item = priced;
  if (priced === editor.item) {
    item = sameDraft(editor.item, original) ? row : rebaseDraft(editor.item, row.base);
  }
  return { ...editor, original: row, item };
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
  /** Opens the item editor on a row. */
  openItem: (itemId: string) => void;
  /** Opens the item editor on a new row («+ позиція»). */
  newItem: () => void;
  /** A change in the open editor. */
  changeItem: (action: EditorAction) => void;
  /** «Готово» / «Додати позицію». */
  saveItem: () => void;
  /** Drops the editor's draft. */
  closeItem: () => void;
  removeItem: (itemId: string) => void;
  /**
   * «✨ Перерахувати»: sends all named rows (her names and portions, the open editor's draft in
   * place of its row) with the photo for context; the rows marked «змінено» take the new kcal.
   * No-op when nothing needs it or one is running. A photo the server no longer has is dropped,
   * and the rows are priced without it.
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
    // Asked for in the editor: her draft is priced as part of the meal, in place of its row.
    const rows = recalcRows(phase.editor ? putDraft(phase.drafts, phase.editor.item) : phase.drafts);
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

  const openItem = useCallback((itemId: string) => dispatch({ type: 'openItem', itemId }), []);
  const newItem = useCallback(() => dispatch({ type: 'newItem', itemId: `n${++rowSeq.current}` }), []);
  const changeItem = useCallback((action: EditorAction) => dispatch({ type: 'editor', action }), []);
  const saveItem = useCallback(() => dispatch({ type: 'saveItem' }), []);
  const closeItem = useCallback(() => dispatch({ type: 'closeItem' }), []);
  const removeItem = useCallback((itemId: string) => dispatch({ type: 'remove', itemId }), []);

  return {
    phase,
    fromText,
    fromPhoto,
    openItem,
    newItem,
    changeItem,
    saveItem,
    closeItem,
    removeItem,
    recalculate,
    reset,
  };
}

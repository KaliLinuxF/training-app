/**
 * A meal's positions for the whole editor session (docs/meals-macros.md §7.3, §7.4): the saved
 * positions to start with, rows a text or photo estimate APPENDS (at most 30 in all), rows she
 * adds or picks from «Часті страви», the item editor on one row (a local draft applied on
 * «Готово»), «✨ Перерахувати» for the rows the model has to price again, and «Прибрати ці позиції»
 * right after an estimate.
 * The reducer is pure; `useEstimateRunner` runs the requests and feeds it.
 */
import {
  LIMITS,
  type FoodEstimateItem,
  type FoodEstimateRequest,
  type FoodEstimateResponse,
  type ISODate,
  type MacroKey,
} from '@legko/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, ApiError } from '@/lib/api';
import { ui } from '@/store/ui';
import {
  appendDrafts,
  applyRecalc,
  dishKcal,
  draftsTotal,
  editDraft,
  emptyDraft,
  MAX_ROWS,
  needsRecalc,
  putDraft,
  rebaseDraft,
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
import {
  addedMessage,
  emptyEstimateComment,
  estimateItems,
  foundMessage,
  recalculatedMessage,
  UNDONE_MESSAGE,
} from './model';

/** «✨ Перерахувати». */
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
   * The last one that succeeded, with the new total. One asked for in the item editor is not
   * announced: the editor's kcal number says it, the card's total once she applies it.
   */
  done?: { id: number; total: number; fromEditor?: boolean };
}

/** A text or photo estimate in flight. */
export interface EstimateLoad {
  id: number;
  photo: boolean;
  /** Thumbnail (`data:` URL) of the photo being estimated, once prepared. */
  preview: string | null;
  /** The meal text this estimate counts («Що я їла» at the time): it becomes the estimated text on success. */
  counts: string | null;
}

/** A meal's typed kcal / Б · Ж · В (raw input) and whether its macro inputs were open. */
export interface ManualNumbers {
  kcalText: string;
  macroTexts: Record<MacroKey, string>;
  macrosOpen: boolean;
}

/** «Прибрати ці позиції»: the last estimate, while she can still take it back. */
export interface UndoState {
  estimateId: string;
  /** The photo it attached to the meal (taken away with its rows), else null. */
  photoId: string | null;
  /** Her typed numbers its rows replaced (the meal editor puts them back), if any. */
  manual?: ManualNumbers;
}

/** What the polite status region says; a new key reads it out again even when the text repeats. */
export interface Notice {
  key: string;
  text: string;
}

export interface PositionsState {
  drafts: DraftItem[];
  /** The model's remark on the last estimate (or recalculation); '' when none. */
  comment: string;
  loading: EstimateLoad | null;
  /** Why the last estimate failed (shown inline until the next attempt). */
  error?: string;
  /** The last estimate found nothing: the card shows its advice and «+ позиція» even without rows. */
  emptyResult: boolean;
  recalc: RecalcState;
  /** The item editor, when open: one row's local draft (not in `drafts` until saved). */
  editor: ItemEditorState | null;
  undo: UndoState | null;
  /** The photo estimated last in this session: a recalculation sends it for context. */
  estimatedPhoto: string | null;
  notice: Notice | null;
}

export const initialPositions = (drafts: DraftItem[] = []): PositionsState => ({
  drafts,
  comment: '',
  loading: null,
  emptyResult: false,
  recalc: { pending: null },
  editor: null,
  undo: null,
  estimatedPhoto: null,
  notice: null,
});

export type EstimateAction =
  | { type: 'start'; id: number; photo: boolean; counts: string | null }
  | { type: 'preview'; id: number; preview: string }
  /** `attached`: the meal took the estimate's photo (below the day cap). */
  | { type: 'resolve'; id: number; res: FoodEstimateResponse; attached?: boolean }
  | { type: 'fail'; id: number; message: string }
  /** «Скасувати» while «Рахую калорії…» (or dismissing the last failure): the request is dropped, not the rows. */
  | { type: 'cancel' }
  /** One field of a row, straight in the list (the editor applies its draft with `saveItem`). */
  | { type: 'edit'; itemId: string; field: DraftField; value: string }
  /** An empty row in the list. */
  | { type: 'add'; itemId: string }
  /** A «Часті страви» chip: the dish as a new row (its kcal and macros, pinned). */
  | { type: 'dish'; itemId: string; dish: FoodEstimateItem }
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
  | { type: 'photoGone'; id: number; photoId: string }
  /** «Прибрати ці позиції»: the last estimate's rows go (the meal drops its photo). */
  | { type: 'undo' }
  /** The meal was saved: nothing to take back any more. */
  | { type: 'saved' };

/** Id of the estimate request `id` (carried by the rows it adds). */
export const estimateIdOf = (id: number): string => `e${id}`;

/** Late answers of a cancelled or replaced request (different `id`) are ignored. */
export function estimateReducer(state: PositionsState, action: EstimateAction): PositionsState {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        loading: { id: action.id, photo: action.photo, preview: null, counts: action.counts },
        error: undefined,
        emptyResult: false,
        undo: null,
        notice: null,
      };
    case 'preview':
      return state.loading?.id === action.id
        ? { ...state, loading: { ...state.loading, preview: action.preview } }
        : state;
    case 'resolve': {
      const { loading } = state;
      if (!loading || loading.id !== action.id) return state;
      const estimateId = estimateIdOf(action.id);
      const rows = toDrafts(estimateItems(action.res), { prefix: `${estimateId}.`, estimateId });
      const { drafts, added } = appendDrafts(state.drafts, rows);
      const photoId = action.res.photoId ?? null;
      const remark = action.res.comment.trim();
      return {
        ...state,
        drafts,
        loading: null,
        comment: remark || (added.length === 0 ? emptyEstimateComment(loading.photo) : ''),
        emptyResult: added.length === 0,
        undo: added.length > 0 ? { estimateId, photoId: action.attached && photoId ? photoId : null } : null,
        estimatedPhoto: loading.photo && photoId ? photoId : state.estimatedPhoto,
        notice: {
          key: `r${action.id}`,
          text: foundMessage(added.length, draftsTotal(added), added.length < rows.length),
        },
      };
    }
    case 'fail':
      return state.loading?.id === action.id ? { ...state, loading: null, error: action.message } : state;
    case 'cancel':
      return state.loading || state.error !== undefined
        ? { ...state, loading: null, error: undefined }
        : state;
    case 'edit':
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.itemId ? editDraft(d, action.field, action.value) : d,
        ),
        undo: touches(state.undo, state.drafts, action.itemId) ? null : state.undo,
      };
    case 'add':
      return state.drafts.length < MAX_ROWS
        ? { ...state, drafts: [...state.drafts, emptyDraft(action.itemId)] }
        : state;
    case 'dish': {
      if (state.drafts.length >= MAX_ROWS) return state;
      const { name, portion } = action.dish;
      const row: DraftItem = {
        ...dishKcal({ ...emptyDraft(action.itemId), name, portion }, action.dish),
        fresh: true,
      };
      return {
        ...state,
        drafts: [...state.drafts, row],
        emptyResult: false,
        notice: {
          key: `a${action.itemId}`,
          text: addedMessage({ items: [action.dish], kcal: action.dish.kcal }),
        },
      };
    }
    case 'remove': {
      const drafts = state.drafts.filter((d) => d.id !== action.itemId);
      if (drafts.length === state.drafts.length) return state;
      const undo = touches(state.undo, state.drafts, action.itemId) ? null : state.undo;
      // «Видалити позицію»: the editor goes with its row, like a dropped draft.
      if (state.editor?.item.id === action.itemId) {
        return { ...state, drafts, undo, editor: null, recalc: dropEditorOutcome(state.recalc) };
      }
      return { ...state, drafts, undo };
    }
    case 'openItem': {
      const row = state.drafts.find((d) => d.id === action.itemId);
      return row ? { ...state, editor: openEditor(row), recalc: toCard(state.recalc) } : state;
    }
    case 'newItem':
      return state.drafts.length < MAX_ROWS
        ? { ...state, editor: newEditor(action.itemId), recalc: toCard(state.recalc) }
        : state;
    case 'editor':
      return state.editor ? { ...state, editor: editorReducer(state.editor, action.action) } : state;
    case 'saveItem': {
      if (!state.editor || !canSave(state.editor)) return state;
      const { editor } = state;
      const edited = editor.original !== null && !sameDraft(editor.item, editor.original);
      return {
        ...state,
        drafts: putDraft(state.drafts, editor.item),
        emptyResult: false,
        // The model's remark on her draft comes with it.
        comment: editor.comment ?? state.comment,
        // Her draft is in the list now: a recalculation still running, or failed, is the card's.
        recalc: toCard(state.recalc),
        editor: null,
        undo: edited && touches(state.undo, state.drafts, editor.item.id) ? null : state.undo,
      };
    }
    case 'closeItem':
      return state.editor ? { ...state, editor: null, recalc: dropEditorOutcome(state.recalc) } : state;
    case 'recalcStart':
      return {
        ...state,
        recalc: { pending: action.id, ...(state.editor ? { fromEditor: true } : {}) },
        notice: null,
      };
    case 'recalcResolve': {
      if (state.recalc.pending !== action.id) return state;
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
      const total = draftsTotal(drafts);
      return {
        ...state,
        drafts,
        editor: remarkInEditor && remark ? { ...editor, comment: remark } : editor,
        comment: !remarkInEditor && tookIt && remark ? remark : state.comment,
        recalc: {
          pending: null,
          done: { id: action.id, total, ...(fromEditor ? { fromEditor: true } : {}) },
        },
        // Asked for in the item editor: its kcal number says what came back (the list total, not yet
        // with her draft in it, would mislead). Dropped with the editor, it has nothing to say either.
        notice: fromEditor ? null : { key: `d${action.id}`, text: recalculatedMessage(total) },
      };
    }
    case 'recalcFail': {
      if (state.recalc.pending !== action.id) return state;
      if (!state.recalc.fromEditor)
        return { ...state, recalc: { pending: null, error: action.message }, notice: null };
      // Asked for in the editor: its alert says why. Unless she has dropped that editor and nothing
      // in the list waits for the model: then it was about nothing that is still there.
      const orphan = state.editor === null && !state.drafts.some(needsRecalc);
      return {
        ...state,
        recalc: orphan
          ? { pending: null, fromEditor: true }
          : { pending: null, error: action.message, fromEditor: true },
        notice: null,
      };
    }
    case 'photoGone':
      // Not sent again, and not kept with the meal: there is nothing left to show.
      if (state.recalc.pending !== action.id) return state;
      return {
        ...state,
        estimatedPhoto: state.estimatedPhoto === action.photoId ? null : state.estimatedPhoto,
        undo: state.undo?.photoId === action.photoId ? { ...state.undo, photoId: null } : state.undo,
      };
    case 'undo': {
      const { undo } = state;
      if (!undo) return state;
      return {
        ...state,
        drafts: state.drafts.filter((d) => d.estimateId !== undo.estimateId),
        comment: '',
        emptyResult: false,
        undo: null,
        notice: { key: `u${undo.estimateId}`, text: UNDONE_MESSAGE },
      };
    }
    case 'saved':
      return state.undo ? { ...state, undo: null } : state;
  }
}

/** The row `itemId` is one of the last estimate's (so changing it ends «Прибрати ці позиції»). */
function touches(undo: UndoState | null, drafts: readonly DraftItem[], itemId: string): boolean {
  return undo !== null && drafts.some((d) => d.id === itemId && d.estimateId === undo.estimateId);
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

/** What the status region says now: progress while a request runs, else the last notice. */
export function liveNotice(state: PositionsState): Notice | null {
  if (state.loading) return { key: `l${state.loading.id}`, text: 'Рахую калорії…' };
  if (state.recalc.pending !== null) return { key: `l${state.recalc.pending}`, text: 'Рахую калорії…' };
  return state.notice;
}

// ---------------------------------------------------------------------------------------------
// Requests

export interface EstimateDeps {
  estimate: typeof api.foodEstimate;
  photo?: PhotoDeps;
  /** Where error messages go besides the inline alert (the app toast by default). */
  notify: (text: string) => void;
}

export const defaultEstimateDeps: EstimateDeps = {
  estimate: api.foodEstimate,
  notify: (text) => ui.flash(text, 2600),
};

export interface EstimateRunner {
  /** Estimates a description. `counts`: the meal text it counts (see `EstimateLoad.counts`). */
  fromText: (text: string, counts: string | null) => void;
  /** Prepares the photo on the device and estimates it (with the optional text as a hint). */
  fromPhoto: (file: File, hint: string, counts: string | null) => void;
  /**
   * «✨ Перерахувати»: sends `rows` (her names and portions) with the photo for context; the rows
   * marked «змінено» take the new numbers. A photo the server no longer has is dropped, and the
   * rows are priced without it.
   */
  recalculate: (rows: RecalcRow[], photoId: string | null) => void;
  /** «Скасувати»: drops the running request (its answer is ignored) and the last error. */
  cancel: () => void;
  /** Drops the running request, quietly (the sheet closed or opened another meal). */
  abort: () => void;
}

interface Send {
  /** Picks the advice when it fails. */
  source: EstimateSource;
  start: (id: number) => EstimateAction;
  call: (id: number, signal: AbortSignal) => Promise<FoodEstimateResponse>;
  /** May throw: the answer is then treated as a failure. */
  resolve: (id: number, res: FoodEstimateResponse) => EstimateAction;
  fail: (id: number, message: string) => EstimateAction;
}

/** The longest description the endpoint takes. */
const clipText = (text: string): string => text.trim().slice(0, LIMITS.foodText).trim();

/**
 * Runs estimate and recalculation requests, one at a time (a new one aborts the previous; aborted
 * answers are dropped), and feeds `dispatch`. `date` is the meal's date at the time of each request.
 */
export function useEstimateRunner(
  date: ISODate,
  dispatch: (action: EstimateAction) => void,
  deps: EstimateDeps = defaultEstimateDeps,
): EstimateRunner {
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ date, dispatch, deps });
  useEffect(() => {
    latest.current = { date, dispatch, deps };
  });

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  // Unmounted mid-request: drop the request.
  useEffect(() => abort, [abort]);

  const send = useCallback(
    ({ source, start, call, resolve, fail }: Send) => {
      abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      const id = ++seq.current;
      latest.current.dispatch(start(id));
      call(id, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          noteEstimateUsed();
          latest.current.dispatch(resolve(id, res));
        })
        .catch((err: unknown) => {
          if (isAbort(err, ctrl.signal)) return;
          const message = estimateErrorMessage(err, source);
          latest.current.dispatch(fail(id, message));
          if (err instanceof ApiError && err.code === 'rate_limited') noteRateLimited();
          latest.current.deps.notify(message);
        })
        .finally(() => {
          if (controller.current === ctrl) controller.current = null;
        });
    },
    [abort],
  );

  const estimateFrom = useCallback(
    (photo: boolean, counts: string | null, call: Send['call']) =>
      send({
        source: photo ? 'photo' : 'text',
        start: (id) => ({ type: 'start', id, photo, counts }),
        call,
        resolve: (id, res) => ({ type: 'resolve', id, res }),
        fail: (id, message) => ({ type: 'fail', id, message }),
      }),
    [send],
  );

  const fromText = useCallback(
    (text: string, counts: string | null) => {
      const t = clipText(text);
      if (!t) return;
      estimateFrom(false, counts, (_id, signal) =>
        latest.current.deps.estimate({ date: latest.current.date, text: t }, signal),
      );
    },
    [estimateFrom],
  );

  const fromPhoto = useCallback(
    (file: File, hint: string, counts: string | null) => {
      estimateFrom(true, counts, async (id, signal) => {
        const photo = await preparePhoto(file, latest.current.deps.photo);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        latest.current.dispatch({ type: 'preview', id, preview: photo.previewUrl });
        const text = clipText(hint);
        return latest.current.deps.estimate(
          {
            date: latest.current.date,
            ...(text ? { text } : {}),
            image: { full: photo.full, thumb: photo.thumb },
          },
          signal,
        );
      });
    },
    [estimateFrom],
  );

  const recalculate = useCallback(
    (rows: RecalcRow[], photoId: string | null) => {
      const request = (withPhoto: boolean): FoodEstimateRequest => ({
        date: latest.current.date,
        items: rows.map(({ name, portion }) => ({ name, portion })),
        // The stored photo gives the model context; it is not stored again.
        ...(withPhoto && photoId ? { photoId } : {}),
      });
      send({
        source: 'recalc',
        start: (id) => ({ type: 'recalcStart', id }),
        call: async (id, signal) => {
          const { estimate } = latest.current.deps;
          if (!photoId) return estimate(request(false), signal);
          try {
            return await estimate(request(true), signal);
          } catch (err) {
            if (signal.aborted || !isPhotoGone(err)) throw err;
            // Cleaned up while the editor stayed open: the photo was only context, and every retry
            // with it would fail the same way. Her rows are priced without it (the 404 cost nothing).
            latest.current.dispatch({ type: 'photoGone', id, photoId });
            return estimate(request(false), signal);
          }
        },
        resolve: (id, res) => {
          if (res.items.length !== rows.length) throw new Error('The recalculation answered for other items');
          return { type: 'recalcResolve', id, rows, res };
        },
        fail: (id, message) => ({ type: 'recalcFail', id, message }),
      });
    },
    [send],
  );

  const cancel = useCallback(() => {
    abort();
    latest.current.dispatch({ type: 'cancel' });
  }, [abort]);

  return useMemo(
    () => ({ fromText, fromPhoto, recalculate, cancel, abort }),
    [fromText, fromPhoto, recalculate, cancel, abort],
  );
}

/**
 * `GET /api/food/status`, fetched once per session and shared by every FoodAssist instance.
 * Refetched when the device comes back online and, once the daily budget ran out, at most
 * hourly on the next mount (the budget resets on the server at midnight).
 */
import type { FoodStatusResponse } from '@legko/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api';

/** `null` = not known yet (loading, offline, server error). */
export type FoodStatus = FoodStatusResponse | null;

const EXHAUSTED_RETRY_MS = 60 * 60 * 1000;
const DISABLED: FoodStatusResponse = { enabled: false, remainingToday: 0 };

let status: FoodStatus = null;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let onlineHooked = false;

function set(next: FoodStatus): void {
  status = next;
  listeners.forEach((l) => l());
}

function isStale(now: number): boolean {
  if (status === null) return true;
  return status.enabled && status.remainingToday <= 0 && now - fetchedAt > EXHAUSTED_RETRY_MS;
}

/** Loads the status unless it is known (or loading) already; `force` refetches anyway. */
export function ensureFoodStatus(force = false, now = Date.now()): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && !isStale(now)) return Promise.resolve();
  inFlight = api
    .foodStatus()
    .then((res) => {
      fetchedAt = Date.now();
      const remaining = Number.isFinite(res.remainingToday) ? Math.max(0, res.remainingToday) : 0;
      set({ enabled: res.enabled === true, remainingToday: remaining });
    })
    .catch((err: unknown) => {
      // An older server without the endpoint: there is no AI, hide the buttons for this session.
      if (err instanceof ApiError && err.status === 404) {
        fetchedAt = Date.now();
        set(DISABLED);
      }
      // Network / 5xx / 401: stay as is and try again later.
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!onlineHooked && typeof window !== 'undefined') {
    onlineHooked = true;
    window.addEventListener('online', () => void ensureFoodStatus(true));
  }
  return () => listeners.delete(listener);
}

const getSnapshot = (): FoodStatus => status;

/** Current status; triggers the (single) fetch on first use. */
export function useFoodStatus(): FoodStatus {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void ensureFoodStatus();
  }, []);
  return value;
}

/** One estimate was used: keep the local counter in step with the server. */
export function noteEstimateUsed(): void {
  if (status) set({ ...status, remainingToday: Math.max(0, status.remainingToday - 1) });
}

/** The server said the daily budget is spent. */
export function noteRateLimited(): void {
  fetchedAt = Date.now();
  set({ enabled: status?.enabled ?? true, remainingToday: 0 });
}

/** Test helper: forget everything (or start from a known status). */
export function resetFoodStatus(next: FoodStatus = null): void {
  status = next;
  fetchedAt = next ? Date.now() : 0;
  inFlight = null;
  listeners.forEach((l) => l());
}

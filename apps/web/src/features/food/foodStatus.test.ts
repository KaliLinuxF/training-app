import type { FoodStatusResponse } from '@legko/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { ensureFoodStatus, noteEstimateUsed, noteRateLimited, resetFoodStatus, useFoodStatus } from './foodStatus';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof ApiModule>();
  return { ...orig, api: { foodStatus: vi.fn() } };
});

const foodStatus = vi.mocked(api.foodStatus);

beforeEach(() => {
  resetFoodStatus();
  foodStatus.mockReset();
});

afterEach(cleanup);

describe('food status', () => {
  it('is fetched once and shared', async () => {
    foodStatus.mockResolvedValue({ enabled: true, remainingToday: 12 });
    const a = renderHook(() => useFoodStatus());
    const b = renderHook(() => useFoodStatus());
    expect(a.result.current).toBeNull();
    await act(() => ensureFoodStatus());
    expect(a.result.current).toEqual({ enabled: true, remainingToday: 12 });
    expect(b.result.current).toEqual({ enabled: true, remainingToday: 12 });
    expect(foodStatus).toHaveBeenCalledOnce();

    act(() => noteEstimateUsed());
    expect(a.result.current?.remainingToday).toBe(11);
    act(() => noteRateLimited());
    expect(a.result.current).toEqual({ enabled: true, remainingToday: 0 });
  });

  it('an older server without the endpoint (404) means «disabled»', async () => {
    foodStatus.mockRejectedValue(new ApiError(404, 'not_found', 'Not found'));
    const { result } = renderHook(() => useFoodStatus());
    await act(() => ensureFoodStatus());
    expect(result.current).toEqual({ enabled: false, remainingToday: 0 });
  });

  it('stays unknown on network errors and retries when back online', async () => {
    foodStatus.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    const { result } = renderHook(() => useFoodStatus());
    await act(() => ensureFoodStatus());
    expect(result.current).toBeNull();

    const online: FoodStatusResponse = { enabled: true, remainingToday: 60 };
    foodStatus.mockResolvedValue(online);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await ensureFoodStatus();
    });
    expect(result.current).toEqual(online);
  });

  it('an exhausted budget is re-checked after an hour', async () => {
    resetFoodStatus({ enabled: true, remainingToday: 0 });
    foodStatus.mockResolvedValue({ enabled: true, remainingToday: 60 });
    await ensureFoodStatus(false, Date.now() + 10 * 60 * 1000);
    expect(foodStatus).not.toHaveBeenCalled();
    await ensureFoodStatus(false, Date.now() + 61 * 60 * 1000);
    expect(foodStatus).toHaveBeenCalledOnce();
  });
});

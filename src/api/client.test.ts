import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  formatApiError,
  listAssets,
  reportDowntime,
  setAuthToken,
  setUnauthorizedHandler,
} from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
  setUnauthorizedHandler(null);
});

describe('client error mapping', () => {
  it('maps a non-2xx response to ApiError preserving the detail', async () => {
    const pointer = {
      message: 'asset already has an ongoing downtime event',
      ongoing_event_id: 7,
      work_order_id: 12,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { detail: pointer })),
    );

    let caught: unknown;
    try {
      await reportDowntime(1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.detail).toEqual(pointer); // the FS-Q1 pointer survives
  });

  it('invokes the unauthorized handler on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { detail: 'invalid or expired session' })),
    );
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await expect(listAssets()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('sends the bearer token once set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('tok-123');

    await listAssets();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-123',
    );
  });
});

describe('formatApiError', () => {
  it('passes string details through', () => {
    expect(formatApiError(new ApiError(409, 'asset is retired'))).toBe(
      'asset is retired',
    );
  });

  it('joins FastAPI validation arrays', () => {
    const error = new ApiError(422, [
      { loc: ['body', 'path'], msg: 'path must be 1-255 characters', type: 'value_error' },
    ]);
    expect(formatApiError(error)).toBe('path must be 1-255 characters');
  });

  it('uses the message of structured details', () => {
    const error = new ApiError(409, {
      message: 'asset already has an ongoing downtime event',
      ongoing_event_id: 7,
      work_order_id: null,
    });
    expect(formatApiError(error)).toBe(
      'asset already has an ongoing downtime event',
    );
  });
});

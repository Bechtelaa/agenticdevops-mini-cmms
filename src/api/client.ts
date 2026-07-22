/**
 * The one fetch wrapper for the renderer↔backend REST boundary.
 *
 * - Base URL: VITE_CMMESS_API_URL, defaulting to the local backend.
 * - Bearer token held in memory only — relaunch = re-login (v1 decision).
 * - Non-2xx → ApiError carrying status + the parsed server `detail`
 *   (the FS-Q1 409 pointer and 403/409 transition details must reach the
 *   UI, never vanish into a generic failure).
 * - Any 401 invokes the registered unauthorized handler (auth state reset).
 *
 * No component may hand-roll a fetch — every endpoint has one typed
 * function here (Rule 12's TS leg lives in ./types.ts).
 */

import type {
  AssetCreate,
  AssetDetailOut,
  AssetOut,
  AssetUpdate,
  DowntimeEventOut,
  DowntimeReportOut,
  LoginResponse,
  PlanBody,
  UserOut,
  WorkOrderCreate,
  WorkOrderDetailOut,
  WorkOrderEdit,
  WorkOrderListFilters,
  WorkOrderOut,
} from './types';

const BASE_URL =
  import.meta.env.VITE_CMMESS_API_URL ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (authToken !== null) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized !== null) {
      onUnauthorized();
    }
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload;
    throw new ApiError(response.status, detail);
  }
  return payload as T;
}

/** Human-readable rendering of an ApiError's server detail. */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const { detail } = error;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc, msg, type}, ...]
      return detail
        .map((item) =>
          typeof item === 'object' && item !== null && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item),
        )
        .join('; ');
    }
    if (typeof detail === 'object' && detail !== null && 'message' in detail) {
      return String((detail as { message: unknown }).message);
    }
    return `request failed (${error.status})`;
  }
  return error instanceof Error ? error.message : 'request failed';
}

// ---- Auth ----

export function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

export function logout(): Promise<void> {
  return request<void>('POST', '/auth/logout');
}

export function me(): Promise<UserOut> {
  return request<UserOut>('GET', '/auth/me');
}

// ---- Assets ----

export function listAssets(includeRetired = false): Promise<AssetOut[]> {
  const query = includeRetired ? '?include_retired=true' : '';
  return request<AssetOut[]>('GET', `/assets${query}`);
}

export function getAsset(assetId: number): Promise<AssetDetailOut> {
  return request<AssetDetailOut>('GET', `/assets/${assetId}`);
}

export function createAsset(body: AssetCreate): Promise<AssetOut> {
  return request<AssetOut>('POST', '/assets', body);
}

export function updateAsset(
  assetId: number,
  body: AssetUpdate,
): Promise<AssetOut> {
  return request<AssetOut>('PATCH', `/assets/${assetId}`, body);
}

export function retireAsset(assetId: number): Promise<AssetOut> {
  return request<AssetOut>('POST', `/assets/${assetId}/retire`);
}

// ---- Downtime events ----

export function reportDowntime(assetId: number): Promise<DowntimeReportOut> {
  return request<DowntimeReportOut>(
    'POST',
    `/assets/${assetId}/downtime-events`,
  );
}

export function endDowntimeEvent(eventId: number): Promise<DowntimeEventOut> {
  return request<DowntimeEventOut>('POST', `/downtime-events/${eventId}/end`);
}

// ---- Work orders ----

export function listWorkOrders(
  filters: WorkOrderListFilters = {},
): Promise<WorkOrderOut[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return request<WorkOrderOut[]>('GET', `/work-orders${query}`);
}

export function getWorkOrder(id: number): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>('GET', `/work-orders/${id}`);
}

export function createWorkOrder(body: WorkOrderCreate): Promise<WorkOrderOut> {
  return request<WorkOrderOut>('POST', '/work-orders', body);
}

export function editWorkOrder(
  id: number,
  body: WorkOrderEdit,
): Promise<WorkOrderOut> {
  return request<WorkOrderOut>('PATCH', `/work-orders/${id}`, body);
}

export function planWorkOrder(
  id: number,
  body: PlanBody,
): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>('POST', `/work-orders/${id}/plan`, body);
}

export function startWorkOrder(id: number): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>('POST', `/work-orders/${id}/start`);
}

export function completeWorkOrder(
  id: number,
  completionNotes: string,
): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>('POST', `/work-orders/${id}/complete`, {
    completion_notes: completionNotes,
  });
}

export function abandonWorkOrder(
  id: number,
  note: string,
): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>('POST', `/work-orders/${id}/abandon`, {
    note,
  });
}

export function cancelWorkOrder(
  id: number,
  note?: string,
): Promise<WorkOrderDetailOut> {
  return request<WorkOrderDetailOut>(
    'POST',
    `/work-orders/${id}/cancel`,
    note !== undefined && note !== '' ? { note } : {},
  );
}

/**
 * TypeScript mirrors of the backend's Pydantic shapes — the TS leg of
 * Rule 12. Authority: docs/api-contract.md; field names and types match it
 * exactly. Datetimes are ISO strings on the wire.
 */

export type UserRole = 'user' | 'planner';
export type AssetProvenance = 'uns_discovered' | 'manual';
export type AssetStatus = 'up' | 'down';
export type DowntimeProducer = 'uns' | 'manual';
export type WorkOrderOrigin = 'uns_downtime' | 'manual_downtime' | 'manual';
export type WorkOrderPriority = 'low' | 'medium' | 'high';
export type WorkOrderStatus =
  | 'open'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

// ---- Auth ----

export interface UserOut {
  id: number;
  username: string;
  role: UserRole;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserOut;
}

// ---- Assets ----

export interface AssetOut {
  id: number;
  path: string;
  display_name: string;
  description: string | null;
  provenance: AssetProvenance;
  retired: boolean;
  status: AssetStatus;
  created_at: string;
  updated_at: string;
}

export interface DowntimeEventOut {
  id: number;
  producer: DowntimeProducer;
  down_at: string;
  up_at: string | null;
  duration_seconds: number | null;
  reported_by: number | null;
  ended_by: number | null;
}

export interface WorkOrderSummaryOut {
  id: number;
  origin: WorkOrderOrigin;
  title: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  created_at: string;
}

export interface AssetDetailOut extends AssetOut {
  downtime_history: DowntimeEventOut[];
  work_orders: WorkOrderSummaryOut[];
}

export interface AssetCreate {
  path: string;
  display_name: string;
  description?: string | null;
}

export interface AssetUpdate {
  display_name?: string | null;
  description?: string | null;
}

// ---- Downtime events ----

export interface DowntimeReportOut {
  event: DowntimeEventOut;
  work_order: WorkOrderSummaryOut;
}

/** The FS-Q1 409 pointer body (docs/api-contract.md § Downtime events). */
export interface OngoingDowntimeDetail {
  message: string;
  ongoing_event_id: number;
  work_order_id: number | null;
}

export function isOngoingDowntimeDetail(
  detail: unknown,
): detail is OngoingDowntimeDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'ongoing_event_id' in detail &&
    'message' in detail
  );
}

// ---- Work orders ----

export interface WorkOrderOut {
  id: number;
  asset_id: number;
  origin: WorkOrderOrigin;
  downtime_event_id: number | null;
  title: string;
  description: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  created_by: number | null;
  assigned_to: number | null;
  scheduled_start: string | null;
  expected_duration_minutes: number | null;
  completion_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransitionOut {
  from_status: WorkOrderStatus;
  to_status: WorkOrderStatus;
  at: string;
  by_user: number | null;
  note: string | null;
}

export interface WorkOrderDetailOut extends WorkOrderOut {
  downtime_event: DowntimeEventOut | null;
  transitions: TransitionOut[];
}

export interface WorkOrderCreate {
  asset_id: number;
  title: string;
  description?: string | null;
  priority?: WorkOrderPriority;
}

export interface WorkOrderEdit {
  title?: string;
  description?: string | null;
}

export interface WorkOrderListFilters {
  status?: WorkOrderStatus;
  asset_id?: number;
  assigned_to?: number;
  origin?: WorkOrderOrigin;
  priority?: WorkOrderPriority;
}

export interface PlanBody {
  assigned_to?: number | null;
  scheduled_start?: string | null;
  expected_duration_minutes?: number | null;
  priority?: WorkOrderPriority;
}

/**
 * The one shared way status renders everywhere (design-guide § patterns):
 * colored dot + text label — never color alone.
 */

import type { AssetStatus, WorkOrderStatus } from '../api/types';

const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function AssetStatusPill({
  status,
  suffix,
}: {
  status: AssetStatus;
  suffix?: string;
}) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span className="status-pill__dot" aria-hidden="true" />
      {status === 'down' ? 'Down' : 'Up'}
      {suffix !== undefined ? ` ${suffix}` : ''}
    </span>
  );
}

export function WoStatusPill({ status }: { status: WorkOrderStatus }) {
  return (
    <span className={`status-pill status-pill--wo-${status}`}>
      <span className="status-pill__dot" aria-hidden="true" />
      {WO_STATUS_LABELS[status]}
    </span>
  );
}

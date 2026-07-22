/** Priority as text tinted with its semantic color — never color-only. */

import type { WorkOrderPriority } from '../api/types';

export function PriorityTag({ priority }: { priority: WorkOrderPriority }) {
  return <span className={`priority-tag priority-tag--${priority}`}>{priority}</span>;
}

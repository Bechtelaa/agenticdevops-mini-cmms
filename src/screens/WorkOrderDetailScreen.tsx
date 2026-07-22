import { useCallback, useEffect, useState, type FormEvent } from 'react';

import * as api from '../api/client';
import { formatApiError } from '../api/client';
import type {
  WorkOrderDetailOut,
  WorkOrderPriority,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/ErrorBanner';
import {
  formatDuration,
  formatTimestamp,
} from '../components/format';
import { PriorityTag } from '../components/PriorityTag';
import { WoStatusPill } from '../components/StatusPill';
import type { Navigate } from './navigation';

const PRIORITIES: WorkOrderPriority[] = ['low', 'medium', 'high'];

function PlanForm({
  wo,
  onDone,
  onError,
}: {
  wo: WorkOrderDetailOut;
  onDone: (updated: WorkOrderDetailOut) => void;
  onError: (message: string) => void;
}) {
  const [assignedTo, setAssignedTo] = useState(
    wo.assigned_to !== null ? String(wo.assigned_to) : '',
  );
  const [scheduledStart, setScheduledStart] = useState('');
  const [duration, setDuration] = useState(
    wo.expected_duration_minutes !== null ? String(wo.expected_duration_minutes) : '',
  );
  const [priority, setPriority] = useState<WorkOrderPriority | ''>('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const updated = await api.planWorkOrder(wo.id, {
        ...(assignedTo !== '' ? { assigned_to: Number(assignedTo) } : {}),
        ...(scheduledStart !== ''
          ? { scheduled_start: new Date(scheduledStart).toISOString() }
          : {}),
        ...(duration !== '' ? { expected_duration_minutes: Number(duration) } : {}),
        ...(priority !== '' ? { priority } : {}),
      });
      onDone(updated);
    } catch (err) {
      onError(formatApiError(err));
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>{wo.status === 'planned' ? 'Re-plan' : 'Plan'}</h3>
      <label>
        Assignee (user id)
        <input
          value={assignedTo}
          onChange={(event) => setAssignedTo(event.target.value)}
          inputMode="numeric"
        />
      </label>
      <label>
        Scheduled start
        <input
          type="datetime-local"
          value={scheduledStart}
          onChange={(event) => setScheduledStart(event.target.value)}
        />
      </label>
      <label>
        Expected duration (minutes)
        <input
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          inputMode="numeric"
        />
      </label>
      <label>
        Priority
        <select
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value as WorkOrderPriority | '')
          }
        >
          <option value="">unchanged</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Save plan</button>
    </form>
  );
}

export function WorkOrderDetailScreen({
  workOrderId,
  navigate,
}: {
  workOrderId: number;
  navigate: Navigate;
}) {
  const { user } = useAuth();
  const [wo, setWo] = useState<WorkOrderDetailOut | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [notes, setNotes] = useState('');

  const load = useCallback(() => {
    api
      .getWorkOrder(workOrderId)
      .then(setWo)
      .catch((err) => setError(formatApiError(err)));
  }, [workOrderId]);

  useEffect(load, [load]);

  if (wo === null || user === null) {
    return (
      <div className="screen">
        <ErrorBanner>{error}</ErrorBanner>
      </div>
    );
  }

  const isPlanner = user.role === 'planner';
  const isExecutor = wo.assigned_to === user.id;
  const terminal = wo.status === 'completed' || wo.status === 'cancelled';

  // Show/hide is UX only — every rejection below surfaces the server's
  // 403/409 detail; the server is the gate (DEC-005).
  const canPlan = isPlanner && (wo.status === 'open' || wo.status === 'planned');
  const canStart =
    wo.status === 'open' || (wo.status === 'planned' && isExecutor);
  const canComplete = wo.status === 'in_progress' && isExecutor;
  const canAbandon = wo.status === 'in_progress' && (isExecutor || isPlanner);
  const canCancel = isPlanner && !terminal;
  const needsNote = canComplete || canAbandon;

  const apply = async (action: () => Promise<WorkOrderDetailOut>) => {
    setActionError('');
    try {
      const updated = await action();
      setWo(updated);
      setNotes('');
      setPlanning(false);
    } catch (err) {
      setActionError(formatApiError(err));
    }
  };

  return (
    <div className="screen">
      <button
        type="button"
        className="link"
        onClick={() => navigate({ name: 'work-orders' })}
      >
        ← Work orders
      </button>
      <div className="screen-header">
        <h2>
          {wo.title} <WoStatusPill status={wo.status} />
        </h2>
      </div>

      <dl className="detail-grid">
        <dt>Origin</dt>
        <dd>{wo.origin}</dd>
        <dt>Priority</dt>
        <dd>
          <PriorityTag priority={wo.priority} />
        </dd>
        <dt>Assigned to</dt>
        <dd>{wo.assigned_to !== null ? `user #${wo.assigned_to}` : '— unassigned'}</dd>
        <dt>Created</dt>
        <dd className="mono">{formatTimestamp(wo.created_at)}</dd>
        {wo.scheduled_start !== null && (
          <>
            <dt>Scheduled start</dt>
            <dd className="mono">{formatTimestamp(wo.scheduled_start)}</dd>
          </>
        )}
        {wo.expected_duration_minutes !== null && (
          <>
            <dt>Expected duration</dt>
            <dd>{formatDuration(wo.expected_duration_minutes * 60)}</dd>
          </>
        )}
        {wo.description !== null && (
          <>
            <dt>Description</dt>
            <dd>{wo.description}</dd>
          </>
        )}
        {wo.completion_notes !== null && (
          <>
            <dt>Completion notes</dt>
            <dd>{wo.completion_notes}</dd>
          </>
        )}
      </dl>

      {wo.downtime_event !== null && (
        <p className="muted">
          Linked downtime event #{wo.downtime_event.id} —{' '}
          {wo.downtime_event.up_at === null
            ? 'ongoing'
            : `ended, ${
                wo.downtime_event.duration_seconds !== null
                  ? formatDuration(wo.downtime_event.duration_seconds)
                  : ''
              }`}
        </p>
      )}

      <div className="action-row">
        {canPlan && (
          <button type="button" onClick={() => setPlanning((value) => !value)}>
            {planning ? 'Close plan' : wo.status === 'planned' ? 'Re-plan' : 'Plan'}
          </button>
        )}
        {canStart && (
          <button type="button" onClick={() => apply(() => api.startWorkOrder(wo.id))}>
            Start
          </button>
        )}
        {canComplete && (
          <button
            type="button"
            disabled={notes.trim() === ''}
            onClick={() => apply(() => api.completeWorkOrder(wo.id, notes))}
          >
            Complete
          </button>
        )}
        {canAbandon && (
          <button
            type="button"
            disabled={notes.trim() === ''}
            onClick={() => apply(() => api.abandonWorkOrder(wo.id, notes))}
          >
            Abandon
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            className="danger"
            onClick={() => apply(() => api.cancelWorkOrder(wo.id))}
          >
            Cancel WO
          </button>
        )}
      </div>
      {needsNote && (
        <label className="notes-field">
          Notes (required to complete or abandon)
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
          />
        </label>
      )}

      <ErrorBanner>{actionError}</ErrorBanner>
      {planning && canPlan && (
        <PlanForm
          wo={wo}
          onDone={(updated) => {
            setWo(updated);
            setPlanning(false);
            setActionError('');
          }}
          onError={setActionError}
        />
      )}

      <h3>History</h3>
      {wo.transitions.length === 0 ? (
        <p className="muted">No transitions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>At</th>
              <th>From</th>
              <th>To</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {wo.transitions.map((transition, index) => (
              <tr key={index}>
                <td className="mono">{formatTimestamp(transition.at)}</td>
                <td>{transition.from_status}</td>
                <td>{transition.to_status}</td>
                <td>
                  {transition.by_user !== null ? `user #${transition.by_user}` : 'system'}
                </td>
                <td>{transition.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

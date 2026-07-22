import { useEffect, useMemo, useState } from 'react';

import * as api from '../api/client';
import { formatApiError } from '../api/client';
import type {
  AssetOut,
  WorkOrderListFilters,
  WorkOrderOrigin,
  WorkOrderOut,
  WorkOrderStatus,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatAge } from '../components/format';
import { PriorityTag } from '../components/PriorityTag';
import { WoStatusPill } from '../components/StatusPill';
import type { Navigate } from './navigation';

type Preset = 'all' | 'queue' | 'mine';

const STATUSES: WorkOrderStatus[] = [
  'open',
  'planned',
  'in_progress',
  'completed',
  'cancelled',
];
const ORIGINS: WorkOrderOrigin[] = ['uns_downtime', 'manual_downtime', 'manual'];

export function WorkOrdersScreen({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  // Planner's working view is the Open queue (FS §6) — their default tab.
  const [preset, setPreset] = useState<Preset>(
    user?.role === 'planner' ? 'queue' : 'all',
  );
  const [status, setStatus] = useState<WorkOrderStatus | ''>('');
  const [origin, setOrigin] = useState<WorkOrderOrigin | ''>('');
  const [orders, setOrders] = useState<WorkOrderOut[] | null>(null);
  const [assets, setAssets] = useState<AssetOut[]>([]);
  const [error, setError] = useState('');

  const filters = useMemo<WorkOrderListFilters>(() => {
    const result: WorkOrderListFilters = {};
    if (preset === 'queue') {
      result.status = 'open';
    } else if (status !== '') {
      result.status = status;
    }
    if (preset === 'mine' && user !== null) {
      result.assigned_to = user.id;
    }
    if (origin !== '') {
      result.origin = origin;
    }
    return result;
  }, [preset, status, origin, user]);

  useEffect(() => {
    api
      .listWorkOrders(filters)
      .then(setOrders)
      .catch((err) => setError(formatApiError(err)));
  }, [filters]);

  useEffect(() => {
    api
      .listAssets(true)
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  const assetPath = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset.path]));
    return (id: number) => byId.get(id) ?? `#${id}`;
  }, [assets]);

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Work orders</h2>
      </div>
      <div className="filter-row">
        <div className="tabs" role="tablist">
          <button
            type="button"
            className={preset === 'all' ? 'tab tab--active' : 'tab'}
            onClick={() => setPreset('all')}
          >
            All
          </button>
          <button
            type="button"
            className={preset === 'queue' ? 'tab tab--active' : 'tab'}
            onClick={() => setPreset('queue')}
          >
            Open queue
          </button>
          <button
            type="button"
            className={preset === 'mine' ? 'tab tab--active' : 'tab'}
            onClick={() => setPreset('mine')}
          >
            My work
          </button>
        </div>
        <label>
          Status
          <select
            value={preset === 'queue' ? 'open' : status}
            disabled={preset === 'queue'}
            onChange={(event) => setStatus(event.target.value as WorkOrderStatus | '')}
          >
            <option value="">any</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origin
          <select
            value={origin}
            onChange={(event) => setOrigin(event.target.value as WorkOrderOrigin | '')}
          >
            <option value="">any</option>
            {ORIGINS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBanner>{error}</ErrorBanner>
      {orders !== null && orders.length === 0 ? (
        <p className="muted">No work orders match.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Asset</th>
              <th>Origin</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((wo) => (
              <tr
                key={wo.id}
                className="clickable"
                onClick={() => navigate({ name: 'wo-detail', workOrderId: wo.id })}
              >
                <td>{wo.title}</td>
                <td className="mono">{assetPath(wo.asset_id)}</td>
                <td>{wo.origin}</td>
                <td>
                  <PriorityTag priority={wo.priority} />
                </td>
                <td>
                  <WoStatusPill status={wo.status} />
                </td>
                <td>{formatAge(wo.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

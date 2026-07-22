import { useCallback, useEffect, useState, type FormEvent } from 'react';

import * as api from '../api/client';
import { ApiError, formatApiError } from '../api/client';
import {
  isOngoingDowntimeDetail,
  type AssetDetailOut,
  type OngoingDowntimeDetail,
} from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatDuration, formatTimestamp } from '../components/format';
import { PriorityTag } from '../components/PriorityTag';
import { AssetStatusPill, WoStatusPill } from '../components/StatusPill';
import type { Navigate } from './navigation';

function EditForm({
  asset,
  onSaved,
}: {
  asset: AssetDetailOut;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(asset.display_name);
  const [description, setDescription] = useState(asset.description ?? '');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api.updateAsset(asset.id, {
        display_name: displayName,
        description: description === '' ? null : description,
      });
      onSaved();
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>Edit asset</h3>
      <label>
        Display name
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label>
        Description
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <ErrorBanner>{error}</ErrorBanner>
      <button type="submit" disabled={!displayName}>
        Save
      </button>
    </form>
  );
}

export function AssetDetailScreen({
  assetId,
  navigate,
}: {
  assetId: number;
  navigate: Navigate;
}) {
  const [asset, setAsset] = useState<AssetDetailOut | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [ongoing, setOngoing] = useState<OngoingDowntimeDetail | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api
      .getAsset(assetId)
      .then(setAsset)
      .catch((err) => setError(formatApiError(err)));
  }, [assetId]);

  useEffect(load, [load]);

  if (asset === null) {
    return (
      <div className="screen">
        <ErrorBanner>{error}</ErrorBanner>
      </div>
    );
  }

  const ongoingManualEvent = asset.downtime_history.find(
    (event) => event.up_at === null && event.producer === 'manual',
  );
  const isManual = asset.provenance === 'manual';

  const run = async (action: () => Promise<unknown>) => {
    setActionError('');
    setOngoing(null);
    try {
      await action();
      load();
    } catch (err) {
      if (err instanceof ApiError && isOngoingDowntimeDetail(err.detail)) {
        setOngoing(err.detail);
      } else {
        setActionError(formatApiError(err));
      }
    }
  };

  return (
    <div className="screen">
      <button type="button" className="link" onClick={() => navigate({ name: 'assets' })}>
        ← Assets
      </button>
      <div className="screen-header">
        <h2>
          {asset.display_name} <AssetStatusPill status={asset.status} />
          {asset.retired && <span className="retired-badge">retired</span>}
        </h2>
      </div>
      <p className="asset-path">{asset.path}</p>
      {asset.description !== null && <p className="muted">{asset.description}</p>}

      <div className="action-row">
        {!asset.retired && (
          <button type="button" onClick={() => run(() => api.reportDowntime(asset.id))}>
            Report downtime
          </button>
        )}
        {ongoingManualEvent !== undefined && (
          <button
            type="button"
            onClick={() => run(() => api.endDowntimeEvent(ongoingManualEvent.id))}
          >
            Mark back up
          </button>
        )}
        {!asset.retired && (
          <button
            type="button"
            onClick={() => navigate({ name: 'wo-create', assetId: asset.id })}
          >
            Create WO
          </button>
        )}
        {/* Edit/retire hidden for uns_discovered — display-only mirror of
            the server's DEC-008 rule; the server remains the gate. */}
        {isManual && (
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Close edit' : 'Edit'}
          </button>
        )}
        {isManual && !asset.retired && (
          <button
            type="button"
            className="danger"
            onClick={() => run(() => api.retireAsset(asset.id))}
          >
            Retire
          </button>
        )}
      </div>

      <ErrorBanner>{actionError}</ErrorBanner>
      {ongoing !== null && (
        <div className="error-banner" role="alert">
          {ongoing.message} — event #{ongoing.ongoing_event_id}
          {ongoing.work_order_id !== null && (
            <>
              {', '}
              <button
                type="button"
                className="link"
                onClick={() =>
                  navigate({ name: 'wo-detail', workOrderId: ongoing.work_order_id! })
                }
              >
                work order #{ongoing.work_order_id}
              </button>
            </>
          )}
        </div>
      )}

      {editing && (
        <EditForm
          asset={asset}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}

      <h3>Downtime history</h3>
      {asset.downtime_history.length === 0 ? (
        <p className="muted">No downtime recorded.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Down at</th>
              <th>Up at</th>
              <th>Duration</th>
              <th>Producer</th>
            </tr>
          </thead>
          <tbody>
            {asset.downtime_history.map((event) => (
              <tr key={event.id}>
                <td className="mono">{formatTimestamp(event.down_at)}</td>
                <td className="mono">
                  {event.up_at !== null ? formatTimestamp(event.up_at) : '— ongoing'}
                </td>
                <td>
                  {event.duration_seconds !== null
                    ? formatDuration(event.duration_seconds)
                    : '—'}
                </td>
                <td>{event.producer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Work orders</h3>
      {asset.work_orders.length === 0 ? (
        <p className="muted">No work orders for this asset.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Origin</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {asset.work_orders.map((wo) => (
              <tr
                key={wo.id}
                className="clickable"
                onClick={() => navigate({ name: 'wo-detail', workOrderId: wo.id })}
              >
                <td>{wo.title}</td>
                <td>{wo.origin}</td>
                <td>
                  <PriorityTag priority={wo.priority} />
                </td>
                <td>
                  <WoStatusPill status={wo.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

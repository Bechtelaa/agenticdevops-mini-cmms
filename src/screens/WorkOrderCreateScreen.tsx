import { useEffect, useState, type FormEvent } from 'react';

import * as api from '../api/client';
import { formatApiError } from '../api/client';
import type { AssetOut, WorkOrderPriority } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import type { Navigate } from './navigation';

export function WorkOrderCreateScreen({
  navigate,
  prefillAssetId,
}: {
  navigate: Navigate;
  prefillAssetId?: number;
}) {
  const [assets, setAssets] = useState<AssetOut[]>([]);
  const [assetId, setAssetId] = useState(
    prefillAssetId !== undefined ? String(prefillAssetId) : '',
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkOrderPriority>('medium');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listAssets()
      .then(setAssets)
      .catch((err) => setError(formatApiError(err)));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.createWorkOrder({
        asset_id: Number(assetId),
        title,
        description: description === '' ? null : description,
        priority,
      });
      navigate({ name: 'wo-detail', workOrderId: created.id });
    } catch (err) {
      setError(formatApiError(err));
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>New work order</h2>
      </div>
      <form className="panel form" onSubmit={submit}>
        <label>
          Asset
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">select an asset…</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.path} — {asset.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as WorkOrderPriority)}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <ErrorBanner>{error}</ErrorBanner>
        <button type="submit" disabled={busy || assetId === '' || title === ''}>
          Create
        </button>
      </form>
    </div>
  );
}

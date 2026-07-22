import { useCallback, useEffect, useState, type FormEvent } from 'react';

import * as api from '../api/client';
import { formatApiError } from '../api/client';
import type { AssetOut } from '../api/types';
import { buildAssetTree, type AssetTreeNode } from '../components/assetTree';
import { ErrorBanner } from '../components/ErrorBanner';
import { AssetStatusPill } from '../components/StatusPill';
import type { Navigate } from './navigation';

function TreeNode({
  node,
  depth,
  navigate,
}: {
  node: AssetTreeNode;
  depth: number;
  navigate: Navigate;
}) {
  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: `calc(${depth} * var(--space-3))` }}>
        {node.asset !== null ? (
          <button
            type="button"
            className="tree-asset"
            onClick={() => navigate({ name: 'asset-detail', assetId: node.asset!.id })}
          >
            <span className="tree-segment">{node.segment}</span>
            <span className="tree-name">{node.asset.display_name}</span>
            <AssetStatusPill status={node.asset.status} />
          </button>
        ) : (
          <span className="tree-group">{node.segment}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              navigate={navigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const [path, setPath] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createAsset({
        path,
        display_name: displayName,
        description: description === '' ? null : description,
      });
      setPath('');
      setDisplayName('');
      setDescription('');
      onRegistered();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>Register asset</h3>
      <label>
        Path
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="site/area/line/asset"
        />
      </label>
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
      <button type="submit" disabled={busy || !path || !displayName}>
        Register
      </button>
    </form>
  );
}

export function AssetsScreen({ navigate }: { navigate: Navigate }) {
  const [assets, setAssets] = useState<AssetOut[] | null>(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);

  const load = useCallback(() => {
    api
      .listAssets()
      .then(setAssets)
      .catch((err) => setError(formatApiError(err)));
  }, []);

  useEffect(load, [load]);

  const tree = assets !== null ? buildAssetTree(assets) : [];

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Assets</h2>
        <button type="button" onClick={() => setShowRegister((v) => !v)}>
          {showRegister ? 'Close' : 'Register asset'}
        </button>
      </div>
      <ErrorBanner>{error}</ErrorBanner>
      {showRegister && (
        <RegisterForm
          onRegistered={() => {
            setShowRegister(false);
            load();
          }}
        />
      )}
      {assets !== null && assets.length === 0 && (
        <p className="muted">No assets yet — register one to get started.</p>
      )}
      <ul className="tree">
        {tree.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} navigate={navigate} />
        ))}
      </ul>
    </div>
  );
}

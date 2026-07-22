/**
 * App shell: auth gating + state-based navigation (no routing library).
 * The renderer is presentation-only — everything it shows comes from the
 * typed REST client; role-based chrome is display-only UX (DEC-005).
 */

import { useState } from 'react';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { AssetDetailScreen } from './screens/AssetDetailScreen';
import { AssetsScreen } from './screens/AssetsScreen';
import { LoginScreen } from './screens/LoginScreen';
import type { View } from './screens/navigation';
import { WorkOrderCreateScreen } from './screens/WorkOrderCreateScreen';
import { WorkOrderDetailScreen } from './screens/WorkOrderDetailScreen';
import { WorkOrdersScreen } from './screens/WorkOrdersScreen';

function Shell() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>({ name: 'assets' });

  if (user === null) {
    return <LoginScreen />;
  }

  const navSection = view.name.startsWith('asset') ? 'assets' : 'work-orders';

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar-brand">CMMess</div>
        <button
          type="button"
          className={navSection === 'assets' ? 'nav-item nav-item--active' : 'nav-item'}
          onClick={() => setView({ name: 'assets' })}
        >
          Assets
        </button>
        <button
          type="button"
          className={
            navSection === 'work-orders' && view.name !== 'wo-create'
              ? 'nav-item nav-item--active'
              : 'nav-item'
          }
          onClick={() => setView({ name: 'work-orders' })}
        >
          Work Orders
        </button>
        <button
          type="button"
          className={view.name === 'wo-create' ? 'nav-item nav-item--active' : 'nav-item'}
          onClick={() => setView({ name: 'wo-create' })}
        >
          + New WO
        </button>
        <div className="sidebar-footer">
          <div>
            <span className="sidebar-user">{user.username}</span>
            <span className="sidebar-role">{user.role}</span>
          </div>
          <button type="button" className="link" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </nav>
      <main className="content">
        {view.name === 'assets' && <AssetsScreen navigate={setView} />}
        {view.name === 'asset-detail' && (
          <AssetDetailScreen assetId={view.assetId} navigate={setView} />
        )}
        {view.name === 'work-orders' && <WorkOrdersScreen navigate={setView} />}
        {view.name === 'wo-detail' && (
          <WorkOrderDetailScreen workOrderId={view.workOrderId} navigate={setView} />
        )}
        {view.name === 'wo-create' && (
          <WorkOrderCreateScreen navigate={setView} prefillAssetId={view.assetId} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

/** Inline error surface — server detail text, never a swallowed failure. */

import type { ReactNode } from 'react';

export function ErrorBanner({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '') {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      {children}
    </div>
  );
}

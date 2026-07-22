/** Top-level view state — plain React state, no routing library (v1). */

export type View =
  | { name: 'assets' }
  | { name: 'asset-detail'; assetId: number }
  | { name: 'work-orders' }
  | { name: 'wo-detail'; workOrderId: number }
  | { name: 'wo-create'; assetId?: number };

export type Navigate = (view: View) => void;

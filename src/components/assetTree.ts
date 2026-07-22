/**
 * Pure client-side tree from flat asset paths — presentation, not business
 * logic (the backend deliberately returns a flat, path-ordered list).
 */

import type { AssetOut } from '../api/types';

export interface AssetTreeNode {
  /** The last path segment this node represents. */
  segment: string;
  /** Full path from the root to this node. */
  path: string;
  /** The asset registered exactly at this path, if any. */
  asset: AssetOut | null;
  children: AssetTreeNode[];
}

export function buildAssetTree(assets: AssetOut[]): AssetTreeNode[] {
  const roots: AssetTreeNode[] = [];

  const childFor = (
    siblings: AssetTreeNode[],
    segment: string,
    path: string,
  ): AssetTreeNode => {
    let node = siblings.find((candidate) => candidate.segment === segment);
    if (node === undefined) {
      node = { segment, path, asset: null, children: [] };
      siblings.push(node);
      siblings.sort((a, b) => a.segment.localeCompare(b.segment));
    }
    return node;
  };

  for (const asset of assets) {
    const segments = asset.path.split('/');
    let siblings = roots;
    let path = '';
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`;
      const node = childFor(siblings, segment, path);
      if (path === asset.path) {
        node.asset = asset;
      }
      siblings = node.children;
    }
  }
  return roots;
}

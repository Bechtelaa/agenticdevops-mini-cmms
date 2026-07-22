import { describe, expect, it } from 'vitest';

import type { AssetOut } from '../api/types';
import { buildAssetTree } from './assetTree';

function asset(id: number, path: string): AssetOut {
  return {
    id,
    path,
    display_name: `Asset ${id}`,
    description: null,
    provenance: 'manual',
    retired: false,
    status: 'up',
    created_at: '2026-07-22T10:00:00',
    updated_at: '2026-07-22T10:00:00',
  };
}

describe('buildAssetTree', () => {
  it('builds a multi-segment hierarchy with shared prefixes', () => {
    const tree = buildAssetTree([
      asset(1, 'plant/area-1/line-1/pump'),
      asset(2, 'plant/area-1/line-2/mixer'),
      asset(3, 'plant/area-2/oven'),
    ]);

    expect(tree).toHaveLength(1);
    const plant = tree[0];
    expect(plant.segment).toBe('plant');
    expect(plant.asset).toBeNull();
    expect(plant.children.map((n) => n.segment)).toEqual(['area-1', 'area-2']);

    const area1 = plant.children[0];
    expect(area1.children.map((n) => n.segment)).toEqual(['line-1', 'line-2']);
    expect(area1.children[0].children[0].asset?.id).toBe(1);
    expect(plant.children[1].children[0].asset?.id).toBe(3);
  });

  it('sorts siblings and keeps full paths on intermediate nodes', () => {
    const tree = buildAssetTree([asset(1, 'b/x'), asset(2, 'a/y')]);
    expect(tree.map((n) => n.segment)).toEqual(['a', 'b']);
    expect(tree[1].path).toBe('b');
    expect(tree[1].children[0].path).toBe('b/x');
  });

  it('attaches an asset registered at an intermediate node', () => {
    const tree = buildAssetTree([asset(1, 'plant'), asset(2, 'plant/cell')]);
    expect(tree[0].asset?.id).toBe(1);
    expect(tree[0].children[0].asset?.id).toBe(2);
  });

  it('handles single-segment paths', () => {
    const tree = buildAssetTree([asset(1, 'standalone')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].asset?.id).toBe(1);
    expect(tree[0].children).toEqual([]);
  });
});

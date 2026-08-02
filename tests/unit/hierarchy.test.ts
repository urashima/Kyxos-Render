import { describe, expect, it } from 'vitest';
import { HierarchyModel, type HierarchySnapshot } from '../../packages/editor-core/src/hierarchy';

const fixture = (): HierarchySnapshot => ({
  roots: ['a', 'd'],
  nodes: [
    { id: 'a', name: 'A', kind: 'empty', parentId: null, children: ['b', 'c'] },
    { id: 'b', name: 'B', kind: 'entity', parentId: 'a', children: [] },
    { id: 'c', name: 'C', kind: 'entity', parentId: 'a', children: [] },
    { id: 'd', name: 'D', kind: 'empty', parentId: null, children: ['e'] },
    { id: 'e', name: 'E', kind: 'entity', parentId: 'd', children: [] },
  ],
});

const ids = ['copy-1', 'copy-2', 'copy-3', 'copy-4'];
const createModel = () => new HierarchyModel(fixture(), () => ids.shift() ?? crypto.randomUUID());

describe('HierarchyModel', () => {
  it('supports collapse, expansion, keyboard navigation and range selection', () => {
    const model = createModel();
    expect(model.visibleIds()).toEqual(['a', 'd']);
    model.toggleExpanded('a', true);
    expect(model.visibleIds()).toEqual(['a', 'b', 'c', 'd']);
    model.select('b');
    model.select('d', { shift: true });
    expect(model.selectedIds).toEqual(['b', 'c', 'd']);
    expect(model.navigate('ArrowUp')).toBe('c');
    expect(model.navigate('ArrowLeft')).toBe('a');
  });

  it('duplicates a complete subtree with fresh ids', () => {
    const model = createModel();
    const copies = model.duplicate(['a']);
    expect(copies).toEqual(['copy-1']);
    expect(model.getNode('copy-1')).toMatchObject({ name: 'A Copy', children: ['copy-2'] });
    expect(model.getNode('copy-2')).toMatchObject({ name: 'B Copy', parentId: 'copy-1' });
    expect(model.getNode('copy-3')).toMatchObject({ name: 'C Copy', parentId: 'copy-1' });
    expect(model.snapshot().roots).toEqual(['a', 'copy-1', 'd']);
  });

  it('moves nodes with insertion ordering and prevents cycles', () => {
    const model = createModel();
    model.move(['c'], { parentId: 'd', index: 0 });
    expect(model.getNode('d')?.children).toEqual(['c', 'e']);
    expect(model.getNode('c')?.parentId).toBe('d');
    expect(() => model.move(['d'], { parentId: 'e', index: 0 })).toThrow(/own subtree/);
  });

  it('implements cut, paste, rename, add, lock, hide and isolate', () => {
    const model = createModel();
    model.cut(['b']);
    expect(model.paste('d', 1)).toEqual(['b']);
    expect(model.getNode('d')?.children).toEqual(['e', 'b']);
    model.rename('b', 'Renamed');
    expect(model.getNode('b')?.name).toBe('Renamed');

    const camera = model.add('camera', 'd');
    expect(camera.kind).toBe('camera');
    model.setLocked([camera.id], true);
    model.select(camera.id);
    expect(model.selectedIds).not.toContain(camera.id);

    model.setHidden(['d'], true);
    expect(model.isEffectivelyVisible('e')).toBe(false);
    model.setHidden(['d'], false);
    model.isolate(['e']);
    expect(model.isEffectivelyVisible('e')).toBe(true);
    expect(model.isEffectivelyVisible('b')).toBe(false);
    model.clearIsolation();
    expect(model.isEffectivelyVisible('b')).toBe(true);
  });
});

export type HierarchyNodeKind = 'entity' | 'empty' | 'camera' | 'light';

export interface HierarchyNode {
  id: string;
  name: string;
  parentId: string | null;
  kind: HierarchyNodeKind;
  children: string[];
  locked?: boolean;
  hidden?: boolean;
}

export interface HierarchySnapshot {
  nodes: HierarchyNode[];
  roots: string[];
}

export interface HierarchySelectionModifiers {
  shift?: boolean;
  toggle?: boolean;
}

export interface HierarchyDropTarget {
  parentId: string | null;
  index: number;
}

export interface HierarchyClipboard {
  mode: 'copy' | 'cut';
  roots: string[];
  nodes: HierarchyNode[];
}

export type HierarchyNavigationKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End';

const cloneNode = (node: HierarchyNode): HierarchyNode => ({
  ...node,
  children: [...node.children],
});

const defaultIdFactory = (() => {
  let value = 0;
  return () => `node-${Date.now().toString(36)}-${(++value).toString(36)}`;
})();

/**
 * Framework-independent hierarchy behavior used by Studio.
 *
 * The model deliberately owns tree semantics, selection, clipboard and
 * visibility state so UI implementations only render state and dispatch
 * intentions. It has no dependency on PCUI, Three.js or a product bundle.
 */
export class HierarchyModel extends EventTarget {
  private readonly nodes = new Map<string, HierarchyNode>();
  private roots: string[] = [];
  private expanded = new Set<string>();
  private selected = new Set<string>();
  private anchorId: string | null = null;
  private focusId: string | null = null;
  private clipboard: HierarchyClipboard | null = null;
  private isolation: Set<string> | null = null;

  constructor(
    snapshot: HierarchySnapshot,
    private readonly createId: () => string = defaultIdFactory,
  ) {
    super();
    this.replace(snapshot);
  }

  replace(snapshot: HierarchySnapshot): void {
    this.nodes.clear();
    for (const node of snapshot.nodes) {
      if (this.nodes.has(node.id)) throw new Error(`Duplicate hierarchy node: ${node.id}`);
      this.nodes.set(node.id, cloneNode(node));
    }
    this.roots = [...snapshot.roots];
    this.validate();
    this.selected = new Set([...this.selected].filter((id) => this.nodes.has(id)));
    this.expanded = new Set([...this.expanded].filter((id) => this.nodes.has(id)));
    this.anchorId = this.anchorId && this.nodes.has(this.anchorId) ? this.anchorId : null;
    this.focusId = this.focusId && this.nodes.has(this.focusId) ? this.focusId : null;
    this.emit('replace');
  }

  snapshot(): HierarchySnapshot {
    return {
      nodes: [...this.nodes.values()].map(cloneNode),
      roots: [...this.roots],
    };
  }

  get selectedIds(): string[] {
    return [...this.selected];
  }

  get focusedId(): string | null {
    return this.focusId;
  }

  isExpanded(id: string): boolean {
    return this.expanded.has(id);
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  getNode(id: string): HierarchyNode | null {
    const node = this.nodes.get(id);
    return node ? cloneNode(node) : null;
  }

  toggleExpanded(id: string, force?: boolean): void {
    const node = this.requireNode(id);
    if (node.children.length === 0) return;
    const expanded = force ?? !this.expanded.has(id);
    expanded ? this.expanded.add(id) : this.expanded.delete(id);
    this.emit('expanded', { id, expanded });
  }

  collapseSubtree(id: string): void {
    for (const descendant of this.subtreeIds(id)) this.expanded.delete(descendant);
    this.emit('expanded', { id, expanded: false, subtree: true });
  }

  expandSubtree(id: string): void {
    for (const descendant of this.subtreeIds(id)) {
      if (this.requireNode(descendant).children.length) this.expanded.add(descendant);
    }
    this.emit('expanded', { id, expanded: true, subtree: true });
  }

  visibleIds(): string[] {
    const output: string[] = [];
    const visit = (id: string) => {
      output.push(id);
      if (!this.expanded.has(id)) return;
      for (const childId of this.requireNode(id).children) visit(childId);
    };
    for (const rootId of this.roots) visit(rootId);
    return output;
  }

  select(id: string, modifiers: HierarchySelectionModifiers = {}): void {
    const node = this.requireNode(id);
    if (node.locked) return;

    if (modifiers.shift && this.anchorId) {
      const visible = this.visibleIds();
      const anchorIndex = visible.indexOf(this.anchorId);
      const targetIndex = visible.indexOf(id);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        if (!modifiers.toggle) this.selected.clear();
        const [start, end] = anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        for (const candidate of visible.slice(start, end + 1)) {
          if (!this.requireNode(candidate).locked) this.selected.add(candidate);
        }
      }
    } else if (modifiers.toggle) {
      this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
      this.anchorId = id;
    } else {
      this.selected = new Set([id]);
      this.anchorId = id;
    }

    this.focusId = id;
    this.emit('selection', { selectedIds: this.selectedIds, focusedId: id });
  }

  clearSelection(): void {
    this.selected.clear();
    this.anchorId = null;
    this.focusId = null;
    this.emit('selection', { selectedIds: [] });
  }

  navigate(key: HierarchyNavigationKey, extend = false): string | null {
    const visible = this.visibleIds();
    if (visible.length === 0) return null;
    const current = this.focusId && visible.includes(this.focusId) ? this.focusId : visible[0];
    let target = current;
    const index = visible.indexOf(current);
    const node = this.requireNode(current);

    switch (key) {
      case 'ArrowUp': target = visible[Math.max(0, index - 1)]; break;
      case 'ArrowDown': target = visible[Math.min(visible.length - 1, index + 1)]; break;
      case 'Home': target = visible[0]; break;
      case 'End': target = visible.at(-1)!; break;
      case 'ArrowLeft':
        if (this.expanded.has(current) && node.children.length) this.toggleExpanded(current, false);
        else if (node.parentId) target = node.parentId;
        break;
      case 'ArrowRight':
        if (node.children.length && !this.expanded.has(current)) this.toggleExpanded(current, true);
        else if (node.children.length) target = node.children[0];
        break;
    }

    if (target !== current || !this.selected.has(target)) {
      this.select(target, { shift: extend });
    }
    return target;
  }

  rename(id: string, name: string): void {
    const node = this.requireEditable(id);
    const normalized = name.trim();
    if (!normalized) throw new Error('Hierarchy node name cannot be empty.');
    node.name = normalized;
    this.emit('rename', { id, name: normalized });
  }

  add(kind: Exclude<HierarchyNodeKind, 'entity'>, parentId: string | null = null, index?: number): HierarchyNode {
    if (parentId) this.requireEditable(parentId);
    const names: Record<Exclude<HierarchyNodeKind, 'entity'>, string> = {
      empty: 'Empty', camera: 'Camera', light: 'Light',
    };
    const node: HierarchyNode = {
      id: this.uniqueId(), name: names[kind], kind, parentId, children: [],
    };
    this.nodes.set(node.id, node);
    const siblings = this.childrenOf(parentId);
    siblings.splice(this.clampIndex(index ?? siblings.length, siblings.length), 0, node.id);
    this.assignChildren(parentId, siblings);
    this.select(node.id);
    this.emit('add', { node: cloneNode(node) });
    return cloneNode(node);
  }

  move(ids: string[], target: HierarchyDropTarget): void {
    const movingRoots = this.normalizeRoots(ids);
    if (movingRoots.length === 0) return;
    if (target.parentId) this.requireEditable(target.parentId);
    for (const id of movingRoots) {
      this.requireEditable(id);
      if (target.parentId === id || this.subtreeIds(id).includes(target.parentId ?? '')) {
        throw new Error('Cannot move a hierarchy node into its own subtree.');
      }
    }

    for (const id of movingRoots) this.detach(id);
    const siblings = this.childrenOf(target.parentId);
    let index = this.clampIndex(target.index, siblings.length);
    for (const id of movingRoots) {
      siblings.splice(index++, 0, id);
      this.requireNode(id).parentId = target.parentId;
    }
    this.assignChildren(target.parentId, siblings);
    this.validate();
    this.emit('move', { ids: movingRoots, target });
  }

  copy(ids: string[] = this.selectedIds): void {
    const roots = this.normalizeRoots(ids);
    this.clipboard = {
      mode: 'copy', roots, nodes: roots.flatMap((id) => this.subtreeIds(id).map((nodeId) => cloneNode(this.requireNode(nodeId)))),
    };
    this.emit('clipboard', { mode: 'copy', roots });
  }

  cut(ids: string[] = this.selectedIds): void {
    const roots = this.normalizeRoots(ids);
    for (const id of roots) this.requireEditable(id);
    this.clipboard = {
      mode: 'cut', roots, nodes: roots.flatMap((id) => this.subtreeIds(id).map((nodeId) => cloneNode(this.requireNode(nodeId)))),
    };
    this.emit('clipboard', { mode: 'cut', roots });
  }

  paste(parentId: string | null = null, index?: number): string[] {
    if (!this.clipboard) return [];
    if (parentId) this.requireEditable(parentId);
    if (this.clipboard.mode === 'cut') {
      const existing = this.clipboard.roots.filter((id) => this.nodes.has(id));
      this.move(existing, { parentId, index: index ?? this.childrenOf(parentId).length });
      this.clipboard = null;
      return existing;
    }

    const sourceById = new Map(this.clipboard.nodes.map((node) => [node.id, node]));
    const idMap = new Map<string, string>();
    for (const source of this.clipboard.nodes) idMap.set(source.id, this.uniqueId());

    for (const source of this.clipboard.nodes) {
      const clonedId = idMap.get(source.id)!;
      this.nodes.set(clonedId, {
        ...source,
        id: clonedId,
        name: `${source.name} Copy`,
        parentId: sourceById.has(source.parentId ?? '') ? idMap.get(source.parentId!)! : parentId,
        children: source.children.map((childId) => idMap.get(childId)!),
      });
    }

    const newRoots = this.clipboard.roots.map((id) => idMap.get(id)!);
    const siblings = this.childrenOf(parentId);
    let insertAt = this.clampIndex(index ?? siblings.length, siblings.length);
    siblings.splice(insertAt, 0, ...newRoots);
    this.assignChildren(parentId, siblings);
    for (const rootId of newRoots) this.requireNode(rootId).parentId = parentId;
    this.selected = new Set(newRoots);
    this.anchorId = newRoots.at(-1) ?? null;
    this.focusId = this.anchorId;
    this.validate();
    this.emit('paste', { roots: newRoots });
    return newRoots;
  }

  duplicate(ids: string[] = this.selectedIds): string[] {
    this.copy(ids);
    const first = this.normalizeRoots(ids)[0];
    const parentId = first ? this.requireNode(first).parentId : null;
    const siblings = this.childrenOf(parentId);
    const insertAt = first ? siblings.indexOf(first) + 1 : siblings.length;
    return this.paste(parentId, insertAt);
  }

  delete(ids: string[] = this.selectedIds): void {
    const roots = this.normalizeRoots(ids);
    for (const id of roots) this.requireEditable(id);
    for (const id of roots) {
      this.detach(id);
      for (const descendant of this.subtreeIds(id)) {
        this.nodes.delete(descendant);
        this.expanded.delete(descendant);
        this.selected.delete(descendant);
      }
    }
    this.focusId = this.selectedIds.at(-1) ?? null;
    this.anchorId = this.focusId;
    this.emit('delete', { roots });
  }

  setLocked(ids: string[], locked: boolean): void {
    for (const id of ids) {
      const node = this.requireNode(id);
      node.locked = locked;
      if (locked) this.selected.delete(id);
    }
    this.emit('lock', { ids, locked });
  }

  setHidden(ids: string[], hidden: boolean): void {
    for (const id of ids) this.requireEditable(id).hidden = hidden;
    this.emit('visibility', { ids, hidden });
  }

  isolate(ids: string[]): void {
    const keep = new Set<string>();
    for (const id of this.normalizeRoots(ids)) {
      for (const descendant of this.subtreeIds(id)) keep.add(descendant);
      let parentId = this.requireNode(id).parentId;
      while (parentId) {
        keep.add(parentId);
        parentId = this.requireNode(parentId).parentId;
      }
    }
    this.isolation = keep;
    this.emit('isolate', { ids: [...keep] });
  }

  clearIsolation(): void {
    this.isolation = null;
    this.emit('isolate', { ids: null });
  }

  isEffectivelyVisible(id: string): boolean {
    let node: HierarchyNode | null = this.requireNode(id);
    while (node) {
      if (node.hidden) return false;
      node = node.parentId ? this.requireNode(node.parentId) : null;
    }
    return this.isolation ? this.isolation.has(id) : true;
  }

  subtreeIds(id: string): string[] {
    const output: string[] = [];
    const visit = (nodeId: string) => {
      output.push(nodeId);
      for (const childId of this.requireNode(nodeId).children) visit(childId);
    };
    visit(id);
    return output;
  }

  private normalizeRoots(ids: string[]): string[] {
    const candidates = [...new Set(ids)].filter((id) => this.nodes.has(id));
    const selected = new Set(candidates);
    return candidates.filter((id) => {
      let parentId = this.requireNode(id).parentId;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = this.requireNode(parentId).parentId;
      }
      return true;
    });
  }

  private detach(id: string): void {
    const node = this.requireNode(id);
    const siblings = this.childrenOf(node.parentId).filter((candidate) => candidate !== id);
    this.assignChildren(node.parentId, siblings);
  }

  private childrenOf(parentId: string | null): string[] {
    return parentId ? [...this.requireNode(parentId).children] : [...this.roots];
  }

  private assignChildren(parentId: string | null, children: string[]): void {
    if (parentId) this.requireNode(parentId).children = children;
    else this.roots = children;
  }

  private requireNode(id: string): HierarchyNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Hierarchy node not found: ${id}`);
    return node;
  }

  private requireEditable(id: string): HierarchyNode {
    const node = this.requireNode(id);
    if (node.locked) throw new Error(`Hierarchy node is locked: ${id}`);
    return node;
  }

  private uniqueId(): string {
    let id = this.createId();
    while (this.nodes.has(id)) id = this.createId();
    return id;
  }

  private clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(Math.trunc(index), length));
  }

  private validate(): void {
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string, parentId: string | null) => {
      const node = this.requireNode(id);
      if (active.has(id)) throw new Error(`Hierarchy cycle detected at ${id}`);
      if (visited.has(id)) throw new Error(`Hierarchy node has multiple parents: ${id}`);
      if (node.parentId !== parentId) throw new Error(`Hierarchy parent mismatch for ${id}`);
      active.add(id);
      visited.add(id);
      for (const childId of node.children) visit(childId, id);
      active.delete(id);
    };
    for (const rootId of this.roots) visit(rootId, null);
    if (visited.size !== this.nodes.size) {
      const detached = [...this.nodes.keys()].filter((id) => !visited.has(id));
      throw new Error(`Detached hierarchy nodes: ${detached.join(', ')}`);
    }
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('change', { detail: { type, detail } }));
  }
}

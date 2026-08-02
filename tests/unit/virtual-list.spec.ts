import { describe, expect, it } from 'vitest';
import { computeVirtualWindow } from '../../packages/editor-core/src/virtual-list';

describe('fixed-height virtual list window', () => {
  it('returns an empty window for an empty hierarchy', () => {
    expect(computeVirtualWindow({
      total: 0,
      scrollTop: 0,
      viewportHeight: 280,
      rowHeight: 28,
      overscan: 10,
    })).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
      scrollTop: 0,
    });
  });

  it('mounts only visible and overscan rows in a large hierarchy', () => {
    expect(computeVirtualWindow({
      total: 1000,
      scrollTop: 14_000,
      viewportHeight: 280,
      rowHeight: 28,
      overscan: 10,
    })).toEqual({
      start: 490,
      end: 520,
      offsetTop: 13_720,
      totalHeight: 28_000,
      scrollTop: 14_000,
    });
  });

  it('clamps stale scroll positions after filtering or collapsing rows', () => {
    expect(computeVirtualWindow({
      total: 1000,
      scrollTop: 99_999,
      viewportHeight: 280,
      rowHeight: 28,
      overscan: 10,
    })).toEqual({
      start: 980,
      end: 1000,
      offsetTop: 27_440,
      totalHeight: 28_000,
      scrollTop: 27_720,
    });
  });

  it('rejects invalid row heights instead of producing an unusable surface', () => {
    expect(() => computeVirtualWindow({
      total: 10,
      scrollTop: 0,
      viewportHeight: 280,
      rowHeight: 0,
    })).toThrow(/rowHeight/);
  });
});

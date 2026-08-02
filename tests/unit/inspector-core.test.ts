import { describe, expect, it } from 'vitest';
import { MIXED_VALUE, OverrideStore, mixedInspectorValue, validateInspectorValue, writeInspectorValue } from '../../packages/inspector-core/src/index';

describe('schema inspector core', () => {
  it('detects mixed values and applies typed edits', () => {
    const a = { transform: { position: [0, 0, 0] } };
    const b = { transform: { position: [1, 0, 0] } };
    expect(mixedInspectorValue([a, b], '/transform/position')).toBe(MIXED_VALUE);
    expect(writeInspectorValue(a, '/transform/position', [2, 3, 4])).toEqual({ transform: { position: [2, 3, 4] } });
  });

  it('validates range and restores overrides', () => {
    expect(validateInspectorValue({ path: '/roughness', label: 'Roughness', type: 'number', min: 0, max: 1 }, 2)).toEqual(['Roughness must be at most 1.']);
    const overrides = new OverrideStore();
    overrides.set('/roughness', 0.5, 0.2);
    expect(overrides.apply('/roughness', 0.8)).toBe(0.2);
    expect(overrides.restore('/roughness')).toBe(0.5);
  });
});
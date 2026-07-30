import { describe, expect, it } from 'vitest';
import {
  cloneSceneContract,
  validateSceneContract,
} from '../../packages/scene-contract/src/index';
import {
  getMigrationPath,
  migrateSceneContract,
  migrationFixtures,
} from '../../packages/scene-migrations/src/index';
import { createFixtureContract } from '../../packages/test-fixtures/src/index';

describe('Kyxos Scene Contract', () => {
  it('validates a complete fixture and preserves asset:// references', () => {
    const fixture = createFixtureContract();
    const result = validateSceneContract(fixture);
    expect(result).toEqual({ valid: true, issues: [] });
    expect(Object.values(fixture.assets)[0].uri).toMatch(/^asset:\/\/[a-f0-9]{64}$/);
  });

  it('rejects signed URLs, executable content and missing node references', () => {
    const fixture = createFixtureContract();
    const asset = Object.values(fixture.assets)[0];
    asset.uri = 'asset://hash?token=secret' as `asset://${string}`;
    fixture.metadata.description = '<script>alert(1)</script>';
    fixture.nodes[0].parentId = 'missing-parent';
    const result = validateSceneContract(fixture);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['secret', 'xss', 'reference']),
    );
  });

  it('migrates every fixed fixture path without mutating the input', () => {
    const legacy = structuredClone(migrationFixtures.legacy090);
    const migrated = migrateSceneContract(legacy);
    expect(getMigrationPath('0.9.0')).toEqual(['0.9.0', '1.0.0', '1.1.0']);
    expect(migrated.contractVersion).toBe('1.1.0');
    expect(migrated.renderSettings.backend).toBe('auto');
    expect(legacy.contractVersion).toBe('0.9.0');
  });

  it('keeps published snapshots independent when cloned', () => {
    const first = createFixtureContract('v1');
    const second = cloneSceneContract(first);
    second.nodes[0].transform.position.x = 5;
    second.metadata.name = 'v2';
    expect(first.nodes[0].transform.position.x).toBe(0);
    expect(first.metadata.name).toBe('v1');
  });
});

import { describe, expect, it } from 'vitest';
import {
  checkSceneCompatibility,
  createDefaultSceneDocument,
  getDefaultViewerCapabilities,
  migrateSceneDocument,
} from '../../packages/scene-contract/src';

describe('scene contract', () => {
  it('creates and validates a V1 scene document', () => {
    const document = createDefaultSceneDocument({ project: { title: 'Contract Fixture' } });
    const migrated = migrateSceneDocument(document);
    expect(migrated.ok).toBe(true);
    expect(migrated.data?.sceneSchemaVersion).toBe(1);
    expect(migrated.data?.project.title).toBe('Contract Fixture');
  });

  it('rejects newer scene schemas with a stable status code', () => {
    const document = createDefaultSceneDocument();
    const migrated = migrateSceneDocument({ ...document, sceneSchemaVersion: 999 });
    expect(migrated.ok).toBe(false);
    expect(migrated.code).toBe('KX_SCENE_SCHEMA_TOO_NEW');
  });

  it('reports optional capability fallback separately from required failure', () => {
    const document = createDefaultSceneDocument();
    const capabilities = getDefaultViewerCapabilities({
      features: { ...getDefaultViewerCapabilities().features, ssgi: false },
    });
    const optional = checkSceneCompatibility(document, capabilities, {
      revision: 1,
      sceneSchemaVersion: 1,
      minimumViewerVersion: '1.0.0',
      testedViewerVersion: '1.0.0',
      requiredCapabilities: ['webgl2'],
      optionalCapabilities: ['ssgi'],
      createdAt: new Date().toISOString(),
    });
    expect(optional.status).toBe('CompatibleWithFallback');
    expect(optional.code).toBe('KX_OPTIONAL_CAPABILITY_MISSING');

    const required = checkSceneCompatibility(document, capabilities, {
      revision: 1,
      sceneSchemaVersion: 1,
      minimumViewerVersion: '1.0.0',
      testedViewerVersion: '1.0.0',
      requiredCapabilities: ['ssgi'],
      optionalCapabilities: [],
      createdAt: new Date().toISOString(),
    });
    expect(required.status).toBe('Incompatible');
    expect(required.code).toBe('KX_REQUIRED_CAPABILITY_MISSING');
  });
});

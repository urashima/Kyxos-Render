import { describe, expect, it } from 'vitest';
import {
  checkSceneCompatibility,
  createDefaultSceneDocument,
  getDefaultViewerCapabilities,
  migrateSceneDocument,
} from '../../packages/scene-contract/src';

describe('compatibility matrix', () => {
  it('loads current viewer with current and old scene fixtures', () => {
    const current = createDefaultSceneDocument();
    const oldFixture = { ...current, project: { ...current.project, title: 'Old V1 Published Revision' } };
    for (const fixture of [current, oldFixture]) {
      const migrated = migrateSceneDocument(fixture);
      expect(migrated.ok).toBe(true);
      expect(checkSceneCompatibility(migrated.data!, getDefaultViewerCapabilities()).status).toBe(
        'Compatible',
      );
    }
  });

  it('keeps current Studio compatible with previous viewer minor through optional fallback', () => {
    const document = createDefaultSceneDocument();
    const previousMinor = getDefaultViewerCapabilities({
      viewerVersion: '1.0.0',
      features: { ...getDefaultViewerCapabilities().features, webgpu: false, ssgi: false },
    });
    const result = checkSceneCompatibility(document, previousMinor, {
      revision: 1,
      sceneSchemaVersion: 1,
      minimumViewerVersion: '1.0.0',
      testedViewerVersion: '1.0.0',
      requiredCapabilities: ['webgl2'],
      optionalCapabilities: ['webgpu', 'ssgi'],
      createdAt: new Date().toISOString(),
    });
    expect(result.status).toBe('CompatibleWithFallback');
  });
});

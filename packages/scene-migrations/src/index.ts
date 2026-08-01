import {
  KYXOS_SCENE_CONTRACT_VERSION,
  assertSceneContract,
  getRuntimeCompatibility,
  type KyxosSceneContract,
} from '@kyxos/scene-contract';

export type SceneMigration = (input: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<string, { to: string; migrate: SceneMigration }> = {
  '0.9.0': {
    to: '1.0.0',
    migrate(input) {
      const next = structuredClone(input);
      next.contractVersion = '1.0.0';
      next.compatibility ??= { viewerApiMin: '1.0.0', contractMin: '1.0.0', contractMax: '1.0.0' };
      next.capabilities ??= [];
      next.animations ??= [];
      next.materials ??= {};
      next.nodes ??= [];
      return next;
    },
  },
  '1.0.0': {
    to: '1.1.0',
    migrate(input) {
      const next = structuredClone(input);
      next.contractVersion = '1.1.0';
      next.compatibility = getRuntimeCompatibility();
      const renderSettings = (next.renderSettings ?? {}) as Record<string, unknown>;
      renderSettings.effects ??= {};
      renderSettings.backend ??= 'auto';
      renderSettings.qualityPreset ??= 'high';
      renderSettings.exposure ??= 1;
      renderSettings.toneMapping ??= 'AgX';
      next.renderSettings = renderSettings;
      const environment = (next.environment ?? {}) as Record<string, unknown>;
      environment.backgroundIntensity ??= 1;
      environment.backgroundBlur ??= 0;
      environment.transparentBackground ??= false;
      next.environment = environment;
      return next;
    },
  },
};

export function getMigrationPath(from: string, to = KYXOS_SCENE_CONTRACT_VERSION): string[] {
  const path = [from];
  let current = from;
  const visited = new Set<string>();
  while (current !== to) {
    if (visited.has(current)) throw new Error(`Migration cycle detected at ${current}.`);
    visited.add(current);
    const step = migrations[current];
    if (!step) throw new Error(`No Scene Contract migration exists from ${current} to ${to}.`);
    current = step.to;
    path.push(current);
  }
  return path;
}

export function migrateSceneContract(value: unknown, target = KYXOS_SCENE_CONTRACT_VERSION): KyxosSceneContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scene Contract migration input must be an object.');
  let current = structuredClone(value) as Record<string, unknown>;
  let version = String(current.contractVersion ?? '0.9.0');
  const path = getMigrationPath(version, target);
  for (let index = 0; index < path.length - 1; index += 1) {
    const step = migrations[version];
    current = step.migrate(current);
    version = step.to;
  }
  assertSceneContract(current);
  return current;
}

export const migrationFixtures = {
  legacy090: {
    contractVersion: '0.9.0',
    id: 'fixture-legacy-090',
    metadata: { name: 'Legacy', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    assets: {}, nodes: [], materials: {}, animations: [],
    environment: { rotation: 0, intensity: 1, backgroundColor: '#111827' },
    cameras: [{ id: 'camera', name: 'Camera', transform: { position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, target: { x: 0, y: 0, z: 0 }, fov: 45, near: 0.01, far: 100 }],
    activeCameraId: 'camera',
    renderSettings: {},
  },
};

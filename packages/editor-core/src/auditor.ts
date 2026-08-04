import type {
  KyxosSceneContract,
  SceneMaterial,
  ScenePatch,
  TextureRef,
} from '@kyxos/scene-contract';

export type StudioAuditSeverity = 'error' | 'warning' | 'info';

export interface StudioAuditFinding {
  id: string;
  code: string;
  severity: StudioAuditSeverity;
  message: string;
  path: string;
  nodeId?: string;
  assetId?: string;
  materialId?: string;
  safeFix?: ScenePatch;
}

export interface StudioAuditSummary {
  errors: number;
  warnings: number;
  info: number;
  fixable: number;
  total: number;
}

export interface StudioAuditReport {
  sceneId: string;
  generatedAt: string;
  findings: StudioAuditFinding[];
  summary: StudioAuditSummary;
}

export interface StudioAuditOptions {
  ignoredCodes?: Iterable<string>;
  includeOrphanAssets?: boolean;
}

const MATERIAL_TEXTURE_PROPERTIES = [
  'baseColorTexture',
  'metalnessTexture',
  'roughnessTexture',
  'normalTexture',
  'emissiveTexture',
  'aoTexture',
  'clearcoatTexture',
  'clearcoatRoughnessTexture',
  'transmissionTexture',
  'thicknessTexture',
] as const satisfies ReadonlyArray<keyof SceneMaterial>;

const MATERIAL_UNIT_PROPERTIES = [
  'metalness',
  'roughness',
  'opacity',
  'clearcoat',
  'clearcoatRoughness',
  'transmission',
  'sheenRoughness',
  'specularIntensity',
] as const satisfies ReadonlyArray<keyof SceneMaterial>;

function encodePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function findingId(code: string, path: string): string {
  return `${code}:${path}`;
}

function createFinding(
  finding: Omit<StudioAuditFinding, 'id'>,
): StudioAuditFinding {
  return { ...finding, id: findingId(finding.code, finding.path) };
}

function dependencyIds(scene: KyxosSceneContract, roots: Iterable<string>): Set<string> {
  const result = new Set(roots);
  const pending = [...result];
  while (pending.length) {
    const id = pending.pop()!;
    const dependencies = scene.assets[id]?.metadata?.dependencies;
    if (!Array.isArray(dependencies)) continue;
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || result.has(dependency)) continue;
      result.add(dependency);
      pending.push(dependency);
    }
  }
  return result;
}

function materialTextureRefs(material: SceneMaterial): Array<[keyof SceneMaterial, TextureRef]> {
  return MATERIAL_TEXTURE_PROPERTIES.flatMap((property) => {
    const value = material[property];
    return value && typeof value === 'object' && 'assetId' in value
      ? [[property, value as TextureRef]]
      : [];
  });
}

export class StudioAuditor {
  audit(scene: KyxosSceneContract, options: StudioAuditOptions = {}): StudioAuditReport {
    const ignored = new Set(options.ignoredCodes ?? []);
    const findings: StudioAuditFinding[] = [];
    const add = (finding: Omit<StudioAuditFinding, 'id'>): void => {
      if (!ignored.has(finding.code)) findings.push(createFinding(finding));
    };

    const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
    const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
    const lightIds = new Set((scene.lights ?? []).map((light) => light.id));
    const animationIds = new Set(scene.animations.map((animation) => animation.id));
    const referencedAssets = new Set<string>();

    if (!scene.nodes.length) {
      add({
        code: 'scene.empty',
        severity: 'warning',
        message: 'The active scene has no entities.',
        path: '/nodes',
      });
    }

    if (!cameraIds.has(scene.activeCameraId)) {
      add({
        code: 'camera.active-missing',
        severity: 'error',
        message: scene.cameras.length
          ? 'The active camera does not exist. The first available camera can be selected safely.'
          : 'The active camera does not exist and the scene has no fallback camera.',
        path: '/activeCameraId',
        safeFix: scene.cameras[0]
          ? [{ op: 'replace', path: '/activeCameraId', value: scene.cameras[0].id }]
          : undefined,
      });
    }

    const duplicateNames = new Map<string, string[]>();
    for (const node of scene.nodes) {
      const key = node.name.trim().toLocaleLowerCase();
      if (key) duplicateNames.set(key, [...(duplicateNames.get(key) ?? []), node.id]);
    }
    for (const [name, ids] of duplicateNames) {
      if (ids.length < 2) continue;
      add({
        code: 'hierarchy.duplicate-name',
        severity: 'info',
        message: `${ids.length} entities share the name “${name}”.`,
        path: '/nodes',
        nodeId: ids[0],
      });
    }

    for (let index = 0; index < scene.nodes.length; index += 1) {
      const node = scene.nodes[index];
      const nodePath = `/nodes/${index}`;
      const filteredChildren = node.children.filter((childId) => nodesById.has(childId));
      const uniqueChildren = unique(filteredChildren);
      if (uniqueChildren.length !== node.children.length) {
        add({
          code: 'hierarchy.invalid-children',
          severity: 'error',
          message: 'The entity contains missing or duplicate child references.',
          path: `${nodePath}/children`,
          nodeId: node.id,
          safeFix: [{ op: 'replace', path: `${nodePath}/children`, value: uniqueChildren }],
        });
      }
      if (node.parentId && !nodesById.has(node.parentId)) {
        add({
          code: 'hierarchy.parent-missing',
          severity: 'error',
          message: 'The entity references a parent that does not exist.',
          path: `${nodePath}/parentId`,
          nodeId: node.id,
          safeFix: [{ op: 'replace', path: `${nodePath}/parentId`, value: null }],
        });
      } else if (node.parentId) {
        const parent = nodesById.get(node.parentId)!;
        if (!parent.children.includes(node.id)) {
          const parentIndex = scene.nodes.findIndex((entry) => entry.id === parent.id);
          add({
            code: 'hierarchy.parent-child-mismatch',
            severity: 'error',
            message: 'The parent does not contain the entity in its ordered child list.',
            path: `${nodePath}/parentId`,
            nodeId: node.id,
            safeFix: [{
              op: 'replace',
              path: `/nodes/${parentIndex}/children`,
              value: [...parent.children, node.id],
            }],
          });
        }
      }

      const chain = new Set<string>([node.id]);
      let parentId = node.parentId;
      while (parentId) {
        if (chain.has(parentId)) {
          add({
            code: 'hierarchy.cycle',
            severity: 'error',
            message: 'The entity is part of a parenting cycle.',
            path: `${nodePath}/parentId`,
            nodeId: node.id,
          });
          break;
        }
        chain.add(parentId);
        parentId = nodesById.get(parentId)?.parentId ?? null;
      }

      for (const [transformProperty, vector] of Object.entries(node.transform)) {
        for (const axis of ['x', 'y', 'z'] as const) {
          const value = vector[axis];
          if (isFiniteNumber(value)) continue;
          add({
            code: 'transform.non-finite',
            severity: 'error',
            message: `${transformProperty}.${axis} must be a finite number.`,
            path: `${nodePath}/transform/${transformProperty}/${axis}`,
            nodeId: node.id,
            safeFix: [{
              op: 'replace',
              path: `${nodePath}/transform/${transformProperty}/${axis}`,
              value: transformProperty === 'scale' ? 1 : 0,
            }],
          });
        }
      }
      if (['x', 'y', 'z'].some((axis) => Math.abs(node.transform.scale[axis as 'x' | 'y' | 'z']) < 1e-6)) {
        add({
          code: 'transform.zero-scale',
          severity: 'warning',
          message: 'The entity has a zero or near-zero scale and may disappear or produce invalid bounds.',
          path: `${nodePath}/transform/scale`,
          nodeId: node.id,
        });
      }

      if (node.meshAssetId) {
        referencedAssets.add(node.meshAssetId);
        if (!scene.assets[node.meshAssetId]) {
          add({
            code: 'asset.mesh-missing',
            severity: 'error',
            message: 'The mesh asset referenced by this entity does not exist.',
            path: `${nodePath}/meshAssetId`,
            nodeId: node.id,
            assetId: node.meshAssetId,
          });
        }
      }

      const validMaterialSlots = (node.materialSlots ?? []).filter((id) => Boolean(scene.materials[id]));
      if (validMaterialSlots.length !== (node.materialSlots?.length ?? 0)) {
        add({
          code: 'material.slot-missing',
          severity: 'error',
          message: 'One or more material slots reference materials that do not exist.',
          path: `${nodePath}/materialSlots`,
          nodeId: node.id,
          safeFix: [{ op: 'replace', path: `${nodePath}/materialSlots`, value: validMaterialSlots }],
        });
      }

      const validAnimationIds = (node.animationIds ?? []).filter((id) => animationIds.has(id));
      if (validAnimationIds.length !== (node.animationIds?.length ?? 0)) {
        add({
          code: 'animation.reference-missing',
          severity: 'error',
          message: 'One or more animation references do not exist.',
          path: `${nodePath}/animationIds`,
          nodeId: node.id,
          safeFix: [{ op: 'replace', path: `${nodePath}/animationIds`, value: validAnimationIds }],
        });
      }

      if (node.cameraId && !cameraIds.has(node.cameraId)) {
        add({
          code: 'camera.reference-missing',
          severity: 'error',
          message: 'The camera component referenced by this entity does not exist.',
          path: `${nodePath}/cameraId`,
          nodeId: node.id,
          safeFix: [{ op: 'remove', path: `${nodePath}/cameraId` }],
        });
      }
      if (node.lightId && !lightIds.has(node.lightId)) {
        add({
          code: 'light.reference-missing',
          severity: 'error',
          message: 'The light component referenced by this entity does not exist.',
          path: `${nodePath}/lightId`,
          nodeId: node.id,
          safeFix: [{ op: 'remove', path: `${nodePath}/lightId` }],
        });
      }

      if (node.skin) {
        const validJoints = node.skin.joints.filter((jointId) => nodesById.has(jointId));
        if (validJoints.length !== node.skin.joints.length) {
          add({
            code: 'skin.joint-missing',
            severity: 'error',
            message: 'The skin references joints that are not present in the scene hierarchy.',
            path: `${nodePath}/skin/joints`,
            nodeId: node.id,
          });
        }
        if (node.skin.skeletonNodeId && !nodesById.has(node.skin.skeletonNodeId)) {
          add({
            code: 'skin.skeleton-missing',
            severity: 'error',
            message: 'The skin skeleton root is missing.',
            path: `${nodePath}/skin/skeletonNodeId`,
            nodeId: node.id,
          });
        }
      }

      if (node.morphWeights?.some((value) => !isFiniteNumber(value))) {
        add({
          code: 'morph.non-finite',
          severity: 'error',
          message: 'Morph target weights must be finite numbers.',
          path: `${nodePath}/morphWeights`,
          nodeId: node.id,
          safeFix: [{
            op: 'replace',
            path: `${nodePath}/morphWeights`,
            value: node.morphWeights.map((value) => isFiniteNumber(value) ? value : 0),
          }],
        });
      }
    }

    for (const [materialId, material] of Object.entries(scene.materials)) {
      const materialPath = `/materials/${encodePointer(materialId)}`;
      for (const property of MATERIAL_UNIT_PROPERTIES) {
        const value = material[property];
        if (value == null) continue;
        if (!isFiniteNumber(value) || value < 0 || value > 1) {
          add({
            code: 'material.unit-range',
            severity: 'warning',
            message: `${String(property)} must be between 0 and 1.`,
            path: `${materialPath}/${String(property)}`,
            materialId,
            safeFix: [{
              op: 'replace',
              path: `${materialPath}/${String(property)}`,
              value: isFiniteNumber(value) ? clamp(value, 0, 1) : 0,
            }],
          });
        }
      }
      if (material.alphaMode === 'mask' && (!isFiniteNumber(material.alphaCutoff) || material.alphaCutoff < 0 || material.alphaCutoff > 1)) {
        add({
          code: 'material.alpha-cutoff',
          severity: 'warning',
          message: 'Alpha cutoff must be between 0 and 1 for masked materials.',
          path: `${materialPath}/alphaCutoff`,
          materialId,
          safeFix: [{
            op: material.alphaCutoff == null ? 'add' : 'replace',
            path: `${materialPath}/alphaCutoff`,
            value: isFiniteNumber(material.alphaCutoff) ? clamp(material.alphaCutoff, 0, 1) : 0.5,
          }],
        });
      }
      if (material.ior != null && (!isFiniteNumber(material.ior) || material.ior < 1 || material.ior > 2.333)) {
        add({
          code: 'material.ior-range',
          severity: 'warning',
          message: 'Material IOR must be between 1 and 2.333.',
          path: `${materialPath}/ior`,
          materialId,
          safeFix: [{
            op: 'replace',
            path: `${materialPath}/ior`,
            value: isFiniteNumber(material.ior) ? clamp(material.ior, 1, 2.333) : 1.5,
          }],
        });
      }
      for (const [property, reference] of materialTextureRefs(material)) {
        referencedAssets.add(reference.assetId);
        if (scene.assets[reference.assetId]) continue;
        add({
          code: 'texture.reference-missing',
          severity: 'error',
          message: `${String(property)} references a texture asset that does not exist.`,
          path: `${materialPath}/${String(property)}`,
          assetId: reference.assetId,
          materialId,
          safeFix: [{ op: 'remove', path: `${materialPath}/${String(property)}` }],
        });
      }
    }

    if (scene.environment.assetId) {
      referencedAssets.add(scene.environment.assetId);
      if (!scene.assets[scene.environment.assetId]) {
        add({
          code: 'environment.asset-missing',
          severity: 'error',
          message: 'The environment references an asset that does not exist.',
          path: '/environment/assetId',
          assetId: scene.environment.assetId,
          safeFix: [{ op: 'remove', path: '/environment/assetId' }],
        });
      }
    }

    for (let index = 0; index < scene.cameras.length; index += 1) {
      const camera = scene.cameras[index];
      const path = `/cameras/${index}`;
      if (!isFiniteNumber(camera.near) || camera.near <= 0) {
        add({
          code: 'camera.near-invalid',
          severity: 'error',
          message: 'Camera near clip must be greater than zero.',
          path: `${path}/near`,
          safeFix: [{ op: 'replace', path: `${path}/near`, value: 0.01 }],
        });
      }
      if (!isFiniteNumber(camera.far) || camera.far <= Math.max(0, camera.near)) {
        add({
          code: 'camera.far-invalid',
          severity: 'error',
          message: 'Camera far clip must be greater than the near clip.',
          path: `${path}/far`,
          safeFix: [{
            op: 'replace',
            path: `${path}/far`,
            value: Math.max(1000, isFiniteNumber(camera.near) ? camera.near + 1 : 1000),
          }],
        });
      }
      if (camera.projection !== 'orthographic' && (!isFiniteNumber(camera.fov) || camera.fov <= 0 || camera.fov >= 180)) {
        add({
          code: 'camera.fov-invalid',
          severity: 'warning',
          message: 'Perspective camera FOV must be between 0 and 180 degrees.',
          path: `${path}/fov`,
          safeFix: [{ op: 'replace', path: `${path}/fov`, value: 45 }],
        });
      }
      if (camera.projection === 'orthographic' && (!isFiniteNumber(camera.orthographicSize) || camera.orthographicSize <= 0)) {
        add({
          code: 'camera.orthographic-size-invalid',
          severity: 'warning',
          message: 'Orthographic camera size must be greater than zero.',
          path: `${path}/orthographicSize`,
          safeFix: [{
            op: camera.orthographicSize == null ? 'add' : 'replace',
            path: `${path}/orthographicSize`,
            value: 10,
          }],
        });
      }
    }

    for (let index = 0; index < (scene.lights ?? []).length; index += 1) {
      const light = scene.lights![index];
      const path = `/lights/${index}`;
      if (!isFiniteNumber(light.intensity) || light.intensity < 0) {
        add({
          code: 'light.intensity-invalid',
          severity: 'warning',
          message: 'Light intensity must be a non-negative finite number.',
          path: `${path}/intensity`,
          safeFix: [{ op: 'replace', path: `${path}/intensity`, value: 0 }],
        });
      }
      if (light.type === 'spot' && light.innerConeAngle != null && light.outerConeAngle != null && light.innerConeAngle > light.outerConeAngle) {
        add({
          code: 'light.spot-cone-invalid',
          severity: 'warning',
          message: 'Spot light inner cone angle cannot exceed the outer cone angle.',
          path: `${path}/innerConeAngle`,
          safeFix: [{ op: 'replace', path: `${path}/innerConeAngle`, value: light.outerConeAngle }],
        });
      }
    }

    for (const [assetId, asset] of Object.entries(scene.assets)) {
      const dependencies = asset.metadata?.dependencies;
      if (!Array.isArray(dependencies)) continue;
      for (const dependency of dependencies) {
        if (typeof dependency !== 'string' || scene.assets[dependency]) continue;
        add({
          code: 'asset.dependency-missing',
          severity: 'error',
          message: `Asset “${asset.name ?? asset.id}” depends on a missing asset.`,
          path: `/assets/${encodePointer(assetId)}/metadata/dependencies`,
          assetId: dependency,
        });
      }
    }

    if (options.includeOrphanAssets !== false) {
      const usedAssets = dependencyIds(scene, referencedAssets);
      for (const asset of Object.values(scene.assets)) {
        if (usedAssets.has(asset.id) || asset.kind === 'thumbnail') continue;
        add({
          code: 'asset.orphaned',
          severity: 'info',
          message: `Asset “${asset.name ?? asset.id}” has no active scene reference.`,
          path: `/assets/${encodePointer(asset.id)}`,
          assetId: asset.id,
        });
      }
    }

    findings.sort((left, right) => {
      const rank = { error: 0, warning: 1, info: 2 } as const;
      return rank[left.severity] - rank[right.severity]
        || left.code.localeCompare(right.code)
        || left.path.localeCompare(right.path);
    });
    const summary = findings.reduce<StudioAuditSummary>((result, finding) => {
      result[finding.severity === 'error' ? 'errors' : finding.severity === 'warning' ? 'warnings' : 'info'] += 1;
      if (finding.safeFix?.length) result.fixable += 1;
      result.total += 1;
      return result;
    }, { errors: 0, warnings: 0, info: 0, fixable: 0, total: 0 });

    return {
      sceneId: scene.id,
      generatedAt: new Date().toISOString(),
      findings,
      summary,
    };
  }

  safeFixPatch(report: StudioAuditReport): ScenePatch {
    const operations = new Map<string, ScenePatch[number]>();
    for (const finding of report.findings) {
      for (const operation of finding.safeFix ?? []) {
        operations.set(`${operation.op}:${operation.path}`, structuredClone(operation));
      }
    }
    return [...operations.values()];
  }
}

export interface StudioUserDataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StudioUserDataDocument {
  version: 1;
  scopes: Record<string, Record<string, unknown>>;
}

function normalizeScopePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '_') || 'default';
}

export class StudioUserDataStore extends EventTarget {
  private document: StudioUserDataDocument = { version: 1, scopes: {} };

  constructor(
    private readonly key: string,
    private readonly storage: StudioUserDataStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    super();
    const raw = storage?.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StudioUserDataDocument;
      if (parsed.version === 1 && parsed.scopes && typeof parsed.scopes === 'object') {
        this.document = structuredClone(parsed);
      }
    } catch {
      storage?.removeItem(key);
    }
  }

  scope(userId: string, projectId = 'global'): StudioUserDataScope {
    const id = `${normalizeScopePart(userId)}:${normalizeScopePart(projectId)}`;
    return new StudioUserDataScope(this, id);
  }

  export(): string {
    return JSON.stringify(this.document, null, 2);
  }

  import(serialized: string): void {
    const parsed = JSON.parse(serialized) as StudioUserDataDocument;
    if (parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object') {
      throw new Error('Unsupported Studio user-data document.');
    }
    this.document = structuredClone(parsed);
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { scope: null, key: null } }));
  }

  _get<T>(scope: string, key: string, fallback: T): T {
    const value = this.document.scopes[scope]?.[key];
    return value === undefined ? structuredClone(fallback) : structuredClone(value) as T;
  }

  _set(scope: string, key: string, value: unknown): void {
    this.document.scopes[scope] ??= {};
    this.document.scopes[scope][key] = structuredClone(value);
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { scope, key, value: structuredClone(value) } }));
  }

  _delete(scope: string, key: string): void {
    if (!this.document.scopes[scope] || !(key in this.document.scopes[scope])) return;
    delete this.document.scopes[scope][key];
    if (!Object.keys(this.document.scopes[scope]).length) delete this.document.scopes[scope];
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { scope, key, deleted: true } }));
  }

  _list(scope: string): Record<string, unknown> {
    return structuredClone(this.document.scopes[scope] ?? {});
  }

  _clear(scope: string): void {
    if (!this.document.scopes[scope]) return;
    delete this.document.scopes[scope];
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { scope, key: null, cleared: true } }));
  }

  private persist(): void {
    this.storage?.setItem(this.key, JSON.stringify(this.document));
  }
}

export class StudioUserDataScope {
  constructor(
    private readonly store: StudioUserDataStore,
    private readonly id: string,
  ) {}

  get<T>(key: string, fallback: T): T {
    return this.store._get(this.id, key, fallback);
  }

  set(key: string, value: unknown): void {
    this.store._set(this.id, key, value);
  }

  delete(key: string): void {
    this.store._delete(this.id, key);
  }

  list(): Record<string, unknown> {
    return this.store._list(this.id);
  }

  clear(): void {
    this.store._clear(this.id);
  }
}

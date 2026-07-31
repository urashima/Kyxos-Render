# Scene Contract

`@kyxos/scene-contract` is the only shared scene protocol between Studio, Viewer, Public Viewer and backend snapshots.

## Invariants

- `contractVersion` is independent from Viewer and application versions.
- Nodes, materials, assets, cameras and animations use stable IDs.
- Assets use `asset://<sha256>`; signed URLs, storage paths and identity tokens are forbidden.
- Transforms are local position, Euler rotation and scale values.
- Published versions contain complete immutable snapshots.
- Unsupported required capabilities cause a visible compatibility error; properties are not silently dropped.

## Runtime entry points

```ts
validateSceneContract(value)
migrateSceneContract(value)
getContractVersion()
getRuntimeCompatibility()
viewer.validateCompatibility(scene)
viewer.loadScene(scene, assetResolver)
viewer.applyScenePatch(patch)
viewer.getCapabilities()
```

## Current compatibility

| Package | Version | Contract range |
|---|---:|---:|
| `@kyxos/scene-contract` | 1.1.0 | 1.1.0 authoring |
| `@kyxos/viewer` | 1.1.0 | 1.0.0–1.1.0 loading |
| `@kyxos/scene-migrations` | 1.1.0 | 0.9.0 → 1.0.0 → 1.1.0 |

## Render settings

The contract covers backend preference, quality, exposure, tone mapping, environment/background and Kyxos Viewer effects: TRAA, SSAO, GTAO, SSR, SSGI, temporal reprojection, temporal denoise, Poisson denoise, motion blur, bloom, depth of field, FXAA, SMAA, SSAA, LUT, sharpness and sparkle.

Studio must read the Viewer capability description rather than maintain a separate effect registry.

## Migration rule

Every new contract version adds a deterministic migration from the immediately supported predecessor plus fixed fixtures. Published snapshots remain byte-independent records; migration occurs only at load time and never updates an existing release.

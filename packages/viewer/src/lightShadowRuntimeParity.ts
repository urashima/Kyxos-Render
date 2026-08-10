import * as THREE from 'three/webgpu';
import type { SceneLight } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';

interface ShadowParityState {
  id: string;
  castShadow: boolean;
  resolution: number | null;
  intensity: number | null;
  updateMode: 'once' | 'realtime' | null;
}

interface ViewerPrototype {
  setLighting(lights: SceneLight[]): void;
  __kyxosLightShadowRuntimeParityInstalled?: boolean;
}

function scene(viewer: KyxosViewer): THREE.Scene | null {
  return (viewer as unknown as { scene?: THREE.Scene }).scene ?? null;
}

function applyRuntimeShadowParity(viewer: KyxosViewer, lights: SceneLight[]): void {
  const root = scene(viewer);
  if (!root) return;
  const byId = new Map(lights.map((light) => [light.id, light]));
  const diagnostics: ShadowParityState[] = [];

  root.traverse((object) => {
    const id = String(object.userData.kyxosManagedLight ?? '');
    if (!id) return;
    const source = byId.get(id);
    if (!source) return;

    const light = object as THREE.Light & {
      castShadow?: boolean;
      shadow?: {
        intensity?: number;
        autoUpdate?: boolean;
        needsUpdate?: boolean;
        mapSize?: { x?: number; y?: number };
      };
    };
    const shadow = light.shadow;
    if (!shadow || !source.castShadow) {
      diagnostics.push({
        id,
        castShadow: Boolean(source.castShadow),
        resolution: null,
        intensity: null,
        updateMode: null,
      });
      return;
    }

    const sourceShadow = source.shadow ?? {};
    const intensity = Math.max(0, Math.min(1, Number(sourceShadow.intensity ?? 1)));
    const realtime = sourceShadow.autoUpdate !== false;

    // These map directly to Three.js LightShadow runtime semantics. `once`
    // renders one fresh shadow map after a scene/light edit and then freezes it;
    // `realtime` keeps normal automatic updates enabled.
    shadow.intensity = intensity;
    shadow.autoUpdate = realtime;
    shadow.needsUpdate = true;

    diagnostics.push({
      id,
      castShadow: true,
      resolution: Number(shadow.mapSize?.x ?? sourceShadow.mapSize ?? 1024),
      intensity,
      updateMode: realtime ? 'realtime' : 'once',
    });
  });

  viewer.canvas.dataset.managedLightShadows = JSON.stringify(diagnostics);
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosLightShadowRuntimeParityInstalled) {
  const originalSetLighting = prototype.setLighting;
  prototype.setLighting = function setLightingWithShadowParity(
    this: KyxosViewer,
    lights: SceneLight[],
  ): void {
    originalSetLighting.call(this, lights);
    applyRuntimeShadowParity(this, lights);
  };
  prototype.__kyxosLightShadowRuntimeParityInstalled = true;
}

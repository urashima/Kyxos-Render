import * as THREE from 'three/webgpu';
import {
  diffuseColor,
  materialReference,
  metalness,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  perspectiveDepthToViewZ,
  roughness,
  sample,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';

import {
  createScreenSpaceSSSNode,
  type ScreenSpaceSSSOutputMode,
} from '../effects/screenSpaceSSSNode';
import type { DebugView, ScreenSpaceSSSStatus } from '../types';

type ViewerInternals = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  nodes: any[];
  debugView: DebugView;
  beforeNode: any;
  renderPipeline: any;
  debugNodes: Map<DebugView, any>;
  buildPipeline: (reason: string) => void;
  applyOutputSelection: () => void;
  warn: (key: string, message: string) => void;
  getScreenSpaceSSSStatus: () => ScreenSpaceSSSStatus;
};

type ViewerConstructor = { prototype: unknown };

const installKey = Symbol.for('kyxos.viewer.deferred-screen-space-sss-debug');
const debugViews = new Set<DebugView>([
  'sssMask',
  'sssThickness',
  'sssStochastic',
  'sssTemporal',
  'sssDiffusion',
  'sssTranslucency',
]);

function appendScreenSpaceSSSDebug(viewer: ViewerInternals) {
  if (!debugViews.has(viewer.debugView) || !viewer.renderPipeline || !viewer.beforeNode) return;

  const settings = viewer.getScreenSpaceSSSStatus();
  if (!settings.enabled || settings.markedMaterials === 0) return;

  const gBufferPass = pass(viewer.scene, viewer.camera);
  gBufferPass.name = 'Kyxos.ScreenSpaceSSS.DebugGBuffer';
  gBufferPass.transparent = false;
  gBufferPass.options.samples = 0;
  gBufferPass.setMRT(
    mrt({
      output: packNormalToRGB(normalView),
      velocity,
      sssData: vec4(
        materialReference('kyxosSSSMask', 'float'),
        materialReference('kyxosSSSThickness', 'float'),
        roughness,
        1,
      ),
      surface: vec4(diffuseColor.rgb, metalness),
    }),
  );

  const normalPacked = gBufferPass.getTextureNode('output');
  const velocityNode = gBufferPass.getTextureNode('velocity');
  const sssData = gBufferPass.getTextureNode('sssData');
  const surface = gBufferPass.getTextureNode('surface');
  const depth = gBufferPass.getTextureNode('depth');
  const viewZ = sample((uv: any) =>
    perspectiveDepthToViewZ(depth.sample(uv).r, viewer.camera.near, viewer.camera.far),
  );

  gBufferPass.getTexture('output').type = THREE.UnsignedByteType;
  gBufferPass.getTexture('sssData').type = THREE.UnsignedByteType;
  gBufferPass.getTexture('surface').type = THREE.UnsignedByteType;
  viewer.nodes.push(gBufferPass);

  if (viewer.debugView === 'sssMask') {
    viewer.debugNodes.set('sssMask', vec4(vec3(sssData.r), 1));
  } else if (viewer.debugView === 'sssThickness') {
    viewer.debugNodes.set('sssThickness', vec4(vec3(sssData.g), 1));
  } else {
    let outputMode: ScreenSpaceSSSOutputMode = 'translucency';
    if (viewer.debugView === 'sssStochastic') outputMode = 'stochastic';
    else if (viewer.debugView === 'sssTemporal') outputMode = 'temporal';
    else if (viewer.debugView === 'sssDiffusion') outputMode = 'diffusion';

    const effect = createScreenSpaceSSSNode(
      viewer.beforeNode,
      depth,
      viewZ,
      normalPacked,
      velocityNode,
      sssData,
      surface,
      viewer.camera,
      {
        ...settings,
        // Stochastic debug displays the raw current estimate, but it must keep
        // the actual Temporal Filtering state: ON advances the random sequence;
        // OFF freezes it. Forcing false here made the UI appear inverted.
        temporalFiltering: settings.temporalFiltering,
        outputMode,
      },
    );
    viewer.nodes.push(...effect.resources);

    if (viewer.debugView === 'sssDiffusion') {
      // Diffusion is signed. Neutral gray means no change; darker and brighter
      // pixels show where energy is removed from or added to the displayed pixel.
      viewer.debugNodes.set(
        'sssDiffusion',
        vec4(effect.outputNode.rgb.mul(4).add(0.5).clamp(0, 1), 1),
      );
    } else if (viewer.debugView === 'sssTranslucency') {
      // Translucency is a low-energy positive contribution. Amplify only the
      // debug visualization so the production composite remains restrained.
      viewer.debugNodes.set(
        'sssTranslucency',
        vec4(effect.outputNode.rgb.mul(6).clamp(0, 1), 1),
      );
    } else {
      viewer.debugNodes.set(viewer.debugView, vec4(effect.outputNode.rgb.clamp(0, 1), 1));
    }
  }

  viewer.applyOutputSelection();
  viewer.renderPipeline.needsUpdate = true;
}

export function installScreenSpaceSSSDebugExtension(Viewer: ViewerConstructor) {
  const prototype = Viewer.prototype as ViewerInternals & Record<PropertyKey, unknown>;
  if (prototype[installKey]) return;

  const originalBuildPipeline = prototype.buildPipeline;
  prototype.buildPipeline = function (reason: string) {
    originalBuildPipeline.call(this, reason);
    try {
      appendScreenSpaceSSSDebug(this);
    } catch (error) {
      this.warn(
        'screen-space-sss-debug',
        `Screen-space SSS debug buffers were isolated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  Object.defineProperty(prototype, installKey, { value: true });
}

import {
  Fn,
  context,
  max,
  mix,
  nodeObject,
  passTexture,
  screenSize,
  smoothstep,
  uv,
  vec4,
} from 'three/tsl';
import {
  HalfFloatType,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  TempNode,
  Vector2,
} from 'three/webgpu';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';

const quadMesh = new QuadMesh();
const drawingBufferSize = new Vector2();
let rendererState: any;

const TEMPORAL_MOTION_START_PIXELS = 0.125;
const TEMPORAL_MOTION_FULL_PIXELS = 1.75;
const TEMPORAL_MOTION_CURRENT_WEIGHT = 0.95;

type ScreenSpaceSSSTemporalOptions = {
  maxFrames: number;
  clampIntensity: number;
  flickerSuppression: number;
};

/**
 * Ordered SSS temporal feedback pass.
 *
 * The pinned Three.js TemporalReprojectNode is retained for velocity
 * reprojection, previous-depth/normal validation and YCoCg variance clipping.
 * Its accumulate=true route advances history length without explicitly mixing
 * the current color into feedback, which can retain a dark old frame. This
 * wrapper uses accumulate=false and owns a full-resolution feedback target:
 *
 * 1. update the low-resolution stochastic input;
 * 2. run official reprojection against last frame's feedback texture;
 * 3. mix the current frame with the validated history;
 * 4. write that result as next frame's feedback.
 *
 * Keeping these operations in one updateBefore() avoids a cyclic RTT graph and
 * guarantees that motion-adaptive current-frame weighting is applied before the
 * texture becomes history.
 */
class ScreenSpaceSSSTemporalNode extends TempNode {
  private readonly currentNode: any;
  private readonly velocityNode: any;
  private readonly temporalNode: any;
  private readonly historyTarget: RenderTarget;
  private readonly seedMaterial: NodeMaterial;
  private readonly resolveMaterial: NodeMaterial;
  private readonly textureNode: any;

  constructor(
    currentNode: any,
    depthNode: any,
    normalNode: any,
    velocityNode: any,
    camera: any,
    options: ScreenSpaceSSSTemporalOptions,
  ) {
    super('vec4');
    this.currentNode = currentNode;
    this.velocityNode = velocityNode;
    // The runtime TempNode API supports frame updates, but the pinned Three.js
    // declaration does not expose updateBeforeType on user subclasses.
    (this as any).updateBeforeType = NodeUpdateType.FRAME;

    this.historyTarget = new RenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType,
    });
    this.historyTarget.texture.name = 'Kyxos.ScreenSpaceSSS.TemporalHistory';
    this.textureNode = passTexture(this, this.historyTarget.texture);

    this.temporalNode = temporalReproject(
      currentNode,
      depthNode,
      normalNode,
      velocityNode,
      camera,
      {
        mode: 'diffuse',
        accumulate: false,
      },
    );
    this.temporalNode.maxFrames.value = options.maxFrames;
    this.temporalNode.clampIntensity.value = options.clampIntensity;
    this.temporalNode.flickerSuppression.value = options.flickerSuppression;
    this.temporalNode.setHistoryTexture(this.historyTarget.texture);

    this.seedMaterial = new NodeMaterial();
    this.seedMaterial.name = 'Kyxos.ScreenSpaceSSS.TemporalSeed';
    this.resolveMaterial = new NodeMaterial();
    this.resolveMaterial.name = 'Kyxos.ScreenSpaceSSS.TemporalResolve';
  }

  getTextureNode() {
    return this.textureNode;
  }

  getRenderTarget() {
    return this.historyTarget;
  }

  setSize(width: number, height: number) {
    this.historyTarget.setSize(width, height);
  }

  updateBefore(frame: any) {
    const { renderer } = frame;
    renderer.getDrawingBufferSize(drawingBufferSize);
    const width = drawingBufferSize.width;
    const height = drawingBufferSize.height;
    const needsRestart = this.historyTarget.width !== width || this.historyTarget.height !== height;
    this.setSize(width, height);

    // The stochastic input is an RTT/PassTexture at reduced resolution. Update
    // it before both the seed and official reprojection passes sample it.
    if (this.currentNode?.isPassTextureNode === true) {
      frame.updateBeforeNode(this.currentNode.passNode);
    }

    if (needsRestart) {
      rendererState = RendererUtils.resetRendererState(renderer, rendererState);
      renderer.initRenderTarget(this.historyTarget);
      renderer.setRenderTarget(this.historyTarget);
      quadMesh.material = this.seedMaterial;
      quadMesh.name = 'Kyxos.ScreenSpaceSSS.TemporalSeed';
      quadMesh.render(renderer);
      renderer.setRenderTarget(null);
      RendererUtils.restoreRendererState(renderer, rendererState);
    }

    // Run the official reprojection outside the wrapper's saved renderer state.
    // TemporalReprojectNode owns its own reset/restore pair, so nesting it inside
    // ours can restore an intermediate render target and corrupt the feedback.
    frame.updateBeforeNode(this.temporalNode);

    // Write the corrected current/history blend into historyTarget. That texture
    // is not read again until the next frame, avoiding feedback read/write hazards.
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(this.historyTarget);
    quadMesh.material = this.resolveMaterial;
    quadMesh.name = 'Kyxos.ScreenSpaceSSS.TemporalResolve';
    quadMesh.render(renderer);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, rendererState);
  }

  setup(builder: any) {
    const sharedContext = context(builder.getSharedContext());

    const seed = Fn(() => {
      const current = this.currentNode.sample(uv());
      return vec4(current.rgb, 1);
    })();

    const resolve = Fn(() => {
      const uvNode = uv();
      const current = this.currentNode.sample(uvNode);
      const reprojected = this.temporalNode;
      const velocityNdc = this.velocityNode.sample(uvNode).xy;
      const velocityPixels = velocityNdc.mul(screenSize.mul(0.5)).length();
      const motionCurrentWeight = smoothstep(
        TEMPORAL_MOTION_START_PIXELS,
        TEMPORAL_MOTION_FULL_PIXELS,
        velocityPixels,
      ).mul(TEMPORAL_MOTION_CURRENT_WEIGHT);
      const currentWeight = max(reprojected.a, motionCurrentWeight).saturate();

      return vec4(mix(reprojected.rgb, current.rgb, currentWeight), reprojected.a);
    })();

    this.seedMaterial.contextNode = sharedContext;
    this.seedMaterial.fragmentNode = seed;
    this.seedMaterial.needsUpdate = true;

    this.resolveMaterial.contextNode = sharedContext;
    this.resolveMaterial.fragmentNode = resolve;
    this.resolveMaterial.needsUpdate = true;

    return this.textureNode;
  }

  dispose() {
    this.temporalNode.dispose?.();
    this.historyTarget.dispose();
    this.seedMaterial.dispose();
    this.resolveMaterial.dispose();
  }
}

export function screenSpaceSSSTemporalResolve(
  currentNode: any,
  depthNode: any,
  normalNode: any,
  velocityNode: any,
  camera: any,
  options: ScreenSpaceSSSTemporalOptions,
) {
  return nodeObject(
    new ScreenSpaceSSSTemporalNode(
      currentNode,
      depthNode,
      normalNode,
      velocityNode,
      camera,
      options,
    ),
  );
}

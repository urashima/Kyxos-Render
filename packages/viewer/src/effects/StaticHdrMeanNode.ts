import {
  HalfFloatType,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  TempNode,
  Vector2,
} from 'three/webgpu';
import { convertToTexture, Fn, mix, passTexture, texture, uniform, uv } from 'three/tsl';

const size = new Vector2();
const quadMesh = new QuadMesh();
let rendererState: unknown;

export class StaticHdrMeanNode extends TempNode {
  readonly textureNode: any;
  readonly currentWeight = uniform(1);

  private compositeTarget = new RenderTarget(1, 1, {
    depthBuffer: false,
    type: HalfFloatType,
  });
  private historyTarget = new RenderTarget(1, 1, {
    depthBuffer: false,
    type: HalfFloatType,
  });
  private readonly outputTextureNode = passTexture(this, this.compositeTarget.texture);
  private readonly historyTextureNode = texture(this.historyTarget.texture);
  private compositeMaterial: NodeMaterial | null = null;

  constructor(textureNode: any) {
    super('vec4');
    this.textureNode = textureNode;
    this.compositeTarget.texture.name = 'Kyxos.StaticHdrMean.composite';
    this.historyTarget.texture.name = 'Kyxos.StaticHdrMean.history';
    this.updateBeforeType = NodeUpdateType.FRAME;
  }

  setSampleCount(sampleCount: number) {
    this.currentWeight.value = 1 / Math.max(1, Math.round(sampleCount));
  }

  reset() {
    this.setSampleCount(1);
  }

  setSize(width: number, height: number) {
    this.compositeTarget.setSize(width, height);
    this.historyTarget.setSize(width, height);
  }

  getTextureNode() {
    return this.outputTextureNode;
  }

  updateBefore(frame: any) {
    const { renderer } = frame;
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);

    renderer.getDrawingBufferSize(size);
    this.setSize(size.x, size.y);

    this.outputTextureNode.value = this.compositeTarget.texture;
    this.historyTextureNode.value = this.historyTarget.texture;

    quadMesh.material = this.compositeMaterial;
    quadMesh.name = 'Kyxos.StaticHdrMean';
    renderer.setRenderTarget(this.compositeTarget);
    quadMesh.render(renderer);

    const previousHistory = this.historyTarget;
    this.historyTarget = this.compositeTarget;
    this.compositeTarget = previousHistory;

    RendererUtils.restoreRendererState(renderer, rendererState);
  }

  setup(builder: any) {
    this.historyTextureNode.uvNode = this.textureNode.uvNode || uv();

    const average = Fn(() =>
      mix(this.historyTextureNode.sample(), this.textureNode.sample(), this.currentWeight),
    );

    const material = this.compositeMaterial ?? (this.compositeMaterial = new NodeMaterial());
    material.name = 'Kyxos.StaticHdrMean';
    material.fragmentNode = average();

    const properties = builder.getNodeProperties(this);
    properties.textureNode = this.textureNode;

    return this.outputTextureNode;
  }

  dispose() {
    this.compositeTarget.dispose();
    this.historyTarget.dispose();
    this.compositeMaterial?.dispose();
  }
}

export const staticHdrMean = (node: any) => new StaticHdrMeanNode(convertToTexture(node));

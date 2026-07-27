import * as THREE from 'three/webgpu';
import {
  diffuseColor,
  emissive,
  materialMetalness,
  materialRoughness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  screenUV,
  texture3D,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssao } from 'three/addons/tsl/display/SSAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { ssaaPass } from 'three/addons/tsl/display/SSAAPassNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';

import { beforeAfterNode, createWarmLutTexture, gradualBackgroundNode, lensDistortionNode, sparkleNode } from './effects/customNodes';
import { createQualityPreset, mergeEffectSettings } from './presets';
import { createDefaultScene } from './scene/createDefaultScene';
import type {
  BackendName,
  CaptureOptions,
  DebugView,
  EffectName,
  EffectsState,
  KyxosViewerCreateOptions,
  MaterialTextureInputs,
  QualityPresetName,
  StressResult,
  ViewerMetrics,
} from './types';
import { disposeObject3D, disposeUnknown } from './utils/dispose';

const textureLoader = new THREE.TextureLoader();

function cloneMetrics(metrics: ViewerMetrics): ViewerMetrics {
  return { ...metrics };
}

function clampPixelRatio(value: number) {
  return Math.max(0.5, Math.min(2, value));
}

export class KyxosViewer extends EventTarget {
  static async create(options: KyxosViewerCreateOptions): Promise<KyxosViewer> {
    const viewer = new KyxosViewer(options);
    await viewer.initialize();
    return viewer;
  }

  readonly canvas: HTMLCanvasElement;

  private readonly backendPreference: KyxosViewerCreateOptions['backend'];
  private readonly autoStart: boolean;
  private renderer!: THREE.WebGPURenderer;
  private renderPipeline: any = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private modelRoot!: THREE.Group;
  private animateScene: (elapsed: number, delta: number) => void = () => undefined;
  private animationEnabled = false;
  private resizeObserver: ResizeObserver | null = null;
  private environmentResource: any = null;
  private lutTexture = createWarmLutTexture();
  private materialTextures = new Set<THREE.Texture>();
  private nodes: any[] = [];
  private debugNodes = new Map<DebugView, any>();
  private finalNode: any = null;
  private beforeNode: any = null;
  private debugView: DebugView = 'final';
  private compareEnabled = false;
  private compareSplit = uniform(0.5);
  private effects: EffectsState;
  private quality: QualityPresetName;
  private backend: BackendName = 'webgl2';
  private disposed = false;
  private initialized = false;
  private rebuildQueued = false;
  private lastFrameTime = performance.now();
  private elapsed = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private lastMetricsDispatch = 0;
  private metrics: ViewerMetrics = {
    backend: 'webgl2',
    fps: 0,
    cpuFrameTimeMs: 0,
    gpuFrameTimeMs: null,
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    renderTargets: 0,
    totalGpuBytes: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
  };
  private warnings = new Map<string, string>();

  private constructor(options: KyxosViewerCreateOptions) {
    super();
    this.canvas = options.canvas;
    this.backendPreference = options.backend ?? 'auto';
    this.autoStart = options.autoStart ?? true;
    this.quality = options.quality ?? 'high';
    this.effects = createQualityPreset(this.quality);
    this.metrics.pixelRatio = clampPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 1.5));
  }

  private async initialize() {
    const bundle = createDefaultScene();
    this.scene = bundle.scene;
    this.camera = bundle.camera;
    this.modelRoot = bundle.modelRoot;
    this.animateScene = bundle.animate;
    this.scene.backgroundNode = gradualBackgroundNode();

    this.renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      forceWebGL: this.backendPreference === 'webgl2',
      trackTimestamp: true,
    } as any);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(this.metrics.pixelRatio);
    this.resizeToCanvas();

    await this.renderer.init();

    this.backend = (this.renderer.backend as any)?.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
    this.metrics.backend = this.backend;
    if ((this.renderer.backend as any)?.hasTimestamp) {
      (this.renderer.backend as any).trackTimestamp = true;
    }

    if (this.backendPreference === 'webgpu' && this.backend !== 'webgpu') {
      this.warn('backend', 'WebGPU was requested but unavailable; the official WebGL 2 fallback is active.');
    }

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 18;
    this.controls.target.set(0, 0.9, 0);
    this.controls.update();
    this.controls.addEventListener('end', () => this.resetTemporal('camera-cut'));

    await this.setStudioEnvironment(false);
    this.buildPipeline('initialize');

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeToCanvas();
      this.queuePipelineRebuild('resize');
    });
    this.resizeObserver.observe(this.canvas);

    if (this.autoStart) this.renderer.setAnimationLoop((time: number) => this.renderFrame(time));
    this.initialized = true;
    this.dispatchEvent(new CustomEvent('ready', { detail: this.getMetrics() }));
  }

  private resizeToCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || this.canvas.width || 960));
    const height = Math.max(1, Math.floor(rect.height || this.canvas.height || 540));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(width, height, false);
    this.metrics.width = width;
    this.metrics.height = height;
  }

  private renderFrame(time: number) {
    if (this.disposed || !this.renderPipeline) return;

    const frameStart = performance.now();
    const delta = Math.min(0.1, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    this.elapsed += delta;
    this.controls.update();
    if (this.animationEnabled) this.animateScene(this.elapsed, delta);

    try {
      this.renderPipeline.render();
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
      this.warn('pipeline', `Render pipeline error: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const cpuMs = performance.now() - frameStart;
    this.fpsAccumulator += delta;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.metrics.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    const info = this.renderer.info as any;
    const gpuTimestamp = Number(info.render?.timestamp ?? 0);
    this.metrics.cpuFrameTimeMs = cpuMs;
    this.metrics.gpuFrameTimeMs = gpuTimestamp > 0 ? gpuTimestamp : null;
    this.metrics.drawCalls = Number(info.render?.drawCalls ?? 0);
    this.metrics.triangles = Math.round(Number(info.render?.triangles ?? 0));
    this.metrics.textures = Number(info.memory?.textures ?? 0);
    this.metrics.renderTargets = Number(info.memory?.renderTargets ?? 0);
    this.metrics.totalGpuBytes = Number(info.memory?.total ?? 0);

    if (time - this.lastMetricsDispatch > 250) {
      this.lastMetricsDispatch = time;
      this.dispatchEvent(new CustomEvent('metrics', { detail: this.getMetrics() }));
    }
  }

  private buildPipeline(reason: string) {
    if (this.disposed) return;
    this.disposePipeline();
    this.debugNodes.clear();

    const pipeline = new THREE.RenderPipeline(this.renderer);
    pipeline.outputColorTransform = false;
    this.renderPipeline = pipeline;

    const scenePass = pass(this.scene, this.camera);
    scenePass.name = 'Kyxos.SceneMRT';
    scenePass.options.samples = 0;
    scenePass.setMRT(
      mrt({
        output,
        normal: vec4(packNormalToRGB(normalView).rgb, materialRoughness),
        diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
        velocity,
        emissive: vec4(emissive.rgb, 1),
      }),
    );
    this.nodes.push(scenePass);

    const beauty = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const linearDepth = scenePass.getLinearDepthNode();
    const normalPacked = scenePass.getTextureNode('normal');
    const diffuseMetal = scenePass.getTextureNode('diffuseColor');
    const velocityNode = scenePass.getTextureNode('velocity');
    const emissiveNode = scenePass.getTextureNode('emissive');
    const viewZ = scenePass.getViewZNode();

    const normalTexture = scenePass.getTexture('normal');
    normalTexture.type = THREE.UnsignedByteType;
    const diffuseTexture = scenePass.getTexture('diffuseColor');
    diffuseTexture.type = THREE.UnsignedByteType;
    const emissiveTexture = scenePass.getTexture('emissive');
    emissiveTexture.type = THREE.UnsignedByteType;

    const sceneNormal = sample((uv: any) => unpackRGBToNormal(normalPacked.sample(uv).rgb));
    const metalRoughness = sample((uv: any) => vec2(diffuseMetal.sample(uv).a, normalPacked.sample(uv).a));

    this.debugNodes.set('beauty', renderOutput(beauty));
    this.debugNodes.set('depth', vec4(vec3(linearDepth), 1));
    this.debugNodes.set('velocity', vec4(velocityNode.xy.mul(8).add(0.5), 0, 1));
    this.debugNodes.set('normal', vec4(normalPacked.rgb, 1));
    this.debugNodes.set('diffuseColor', vec4(diffuseMetal.rgb, 1));
    this.debugNodes.set('metalness', vec4(vec3(diffuseMetal.a), 1));
    this.debugNodes.set('roughness', vec4(vec3(normalPacked.a), 1));
    this.debugNodes.set('emissive', vec4(emissiveNode.rgb, 1));

    let source: any = beauty;
    const useSSAA = this.effects.ssaa.enabled;

    if (useSSAA) {
      const ssaaNode = ssaaPass(this.scene, this.camera);
      const requestedSamples = Number(this.effects.ssaa.samples ?? 8);
      ssaaNode.sampleLevel = Math.max(0, Math.min(5, Math.round(Math.log2(Math.max(1, requestedSamples)))));
      source = ssaaNode.getTextureNode();
      this.nodes.push(ssaaNode);
      this.warn(
        'capture-ssaa',
        'Capture SSAA uses the official SSAA pass; depth-dependent AO/SSR/SSGI/DoF are bypassed because they do not share its jittered buffers.',
      );
    } else {
      this.warnings.delete('capture-ssaa');

      if (this.effects.gtao.enabled) {
        try {
          const settings = this.effects.gtao;
          const gtao = ao(depth, sceneNormal, this.camera);
          gtao.samples.value = Number(settings.samples ?? 16);
          gtao.radius.value = Number(settings.radius ?? 0.5);
          gtao.scale.value = Number(settings.intensity ?? 1.2);
          gtao.thickness.value = Number(settings.thickness ?? 1);
          gtao.resolutionScale = Number(settings.resolutionScale ?? 0.5);
          gtao.useTemporalFiltering = this.effects.traa.enabled;
          source = vec4(source.rgb.mul(gtao.getTextureNode().sample(screenUV).r), source.a);
          this.nodes.push(gtao);
        } catch (error) {
          this.effectFailure('gtao', error);
        }
      }

      if (this.effects.ssao.enabled) {
        try {
          const settings = this.effects.ssao;
          const ssaoNode = ssao(depth, sceneNormal, this.camera);
          ssaoNode.samples.value = Number(settings.samples ?? 16);
          ssaoNode.radius.value = Number(settings.radius ?? 0.5);
          ssaoNode.intensity.value = Number(settings.intensity ?? 1.5);
          ssaoNode.resolutionScale = Number(settings.resolutionScale ?? 0.5);
          source = vec4(source.rgb.mul(ssaoNode.getTextureNode().sample(screenUV).r), source.a);
          this.nodes.push(ssaoNode);
        } catch (error) {
          this.effectFailure('ssao', error);
        }
      }

      if (this.effects.ssgi.enabled) {
        try {
          const settings = this.effects.ssgi;
          const gi = ssgi(beauty, depth, sceneNormal, this.camera);
          gi.sliceCount.value = Number(settings.sliceCount ?? 2);
          gi.stepCount.value = Number(settings.stepCount ?? 8);
          gi.radius.value = Number(settings.radius ?? 10);
          gi.giIntensity.value = Number(settings.intensity ?? 1);
          gi.resolutionScale = Number(settings.resolutionScale ?? 0.5);
          gi.useTemporalFiltering = settings.temporalFiltering !== false;
          source = vec4(source.rgb.mul(gi.getAONode()).add(diffuseMetal.rgb.mul(gi.getGINode().rgb)), source.a);
          this.nodes.push(gi);
        } catch (error) {
          this.effectFailure('ssgi', error);
        }
      }

      if (this.effects.ssr.enabled) {
        try {
          const settings = this.effects.ssr;
          const ssrNode = ssr(source, depth, sceneNormal, {
            stochastic: true,
            diffuseNode: diffuseMetal,
            metalnessNode: diffuseMetal.a,
            roughnessNode: normalPacked.a,
            environmentNode: this.scene.environment ?? null,
            envImportanceSampling: true,
            binaryRefine: true,
          });
          ssrNode.resolutionScale = Number(settings.resolutionScale ?? 0.5);
          ssrNode.quality.value = Number(settings.quality ?? 0.25);
          ssrNode.mirrorBias.value = Number(settings.mirrorBias ?? 0.5);
          ssrNode.maxDistance.value = Number(settings.maxDistance ?? 0.4);
          ssrNode.intensity.value = Number(settings.intensity ?? 1);
          ssrNode.thickness.value = Number(settings.thickness ?? 0.1);
          if (this.scene.environment) ssrNode.setEnvMap(this.scene.environment);

          let reflection: any = ssrNode;
          if (this.effects.temporalReprojection.enabled) {
            const temporal = temporalReproject(ssrNode, depth, normalPacked, velocityNode, this.camera, {
              mode: 'specular',
              accumulate: false,
            });
            reflection = temporal;
            this.nodes.push(temporal);

            if (this.effects.temporalDenoise.enabled) {
              const denoiser = recurrentDenoise(temporal, this.camera, {
                depth,
                normal: normalPacked,
                raw: ssrNode,
                metalRoughness,
                mode: 'specular',
                accumulate: true,
              });
              denoiser.alphaSource = 'raylength';
              denoiser.radius.value = Number(this.effects.temporalDenoise.radius ?? 1.5);
              denoiser.strength.value = Number(this.effects.temporalDenoise.strength ?? 0.725);
              ssrNode.setHistory(denoiser, velocityNode);
              temporal.setHistoryTexture(denoiser);
              reflection = denoiser;
              this.nodes.push(denoiser);
            }
          } else if (this.effects.poissonDenoise.enabled) {
            const spatial = denoise(ssrNode, depth, sceneNormal, this.camera);
            spatial.radius.value = Number(this.effects.poissonDenoise.radius ?? 2);
            reflection = spatial;
            this.nodes.push(spatial);
          }

          source = vec4(source.rgb.add(reflection.rgb.mul(Number(settings.intensity ?? 1))), 1);
          this.nodes.push(ssrNode);
        } catch (error) {
          this.effectFailure('ssr', error);
        }
      } else if (this.effects.poissonDenoise.enabled) {
        try {
          const spatial = denoise(source, depth, sceneNormal, this.camera);
          spatial.radius.value = Number(this.effects.poissonDenoise.radius ?? 2);
          source = spatial;
          this.nodes.push(spatial);
        } catch (error) {
          this.effectFailure('poissonDenoise', error);
        }
      }

      if (this.effects.traa.enabled) {
        try {
          const traaNode = traa(source, depth, velocityNode, this.camera);
          traaNode.depthThreshold = Number(this.effects.traa.depthThreshold ?? 0.0005);
          traaNode.edgeDepthDiff = Number(this.effects.traa.edgeDepthDiff ?? 0.001);
          traaNode.maxVelocityLength = Number(this.effects.traa.maxVelocityLength ?? 128);
          traaNode.useSubpixelCorrection = this.effects.traa.useSubpixelCorrection !== false;
          source = traaNode;
          this.nodes.push(traaNode);
        } catch (error) {
          this.effectFailure('traa', error);
        }
      }

      if (this.effects.motionBlur.enabled) {
        try {
          const amount = uniform(Number(this.effects.motionBlur.amount ?? 1));
          source = motionBlur(source, velocityNode.mul(amount));
        } catch (error) {
          this.effectFailure('motionBlur', error);
        }
      }
    }

    if (this.effects.sparkle.enabled) {
      source = sparkleNode(
        source,
        uniform(Number(this.effects.sparkle.intensity ?? 0.4)),
        uniform(Number(this.effects.sparkle.threshold ?? 0.94)),
      );
    }

    if (this.effects.bloom.enabled) {
      try {
        const bloomNode = bloom(source);
        bloomNode.threshold.value = Number(this.effects.bloom.threshold ?? 0.75);
        bloomNode.strength.value = Number(this.effects.bloom.strength ?? 0.5);
        bloomNode.radius.value = Number(this.effects.bloom.radius ?? 0.2);
        source = source.add(bloomNode);
        this.nodes.push(bloomNode);
      } catch (error) {
        this.effectFailure('bloom', error);
      }
    }

    if (this.effects.dof.enabled && !useSSAA) {
      try {
        source = dof(
          source,
          viewZ,
          uniform(Number(this.effects.dof.focusDistance ?? 4)),
          uniform(Number(this.effects.dof.focalLength ?? 45)),
          uniform(Number(this.effects.dof.bokehScale ?? 1.5)),
        );
      } catch (error) {
        this.effectFailure('dof', error);
      }
    }

    this.beforeNode = renderOutput(beauty);
    source = renderOutput(source);

    if (this.effects.lut.enabled) {
      try {
        source = lut3D(
          source,
          texture3D(this.lutTexture),
          this.lutTexture.image.width,
          uniform(Number(this.effects.lut.intensity ?? 0.65)),
        );
      } catch (error) {
        this.effectFailure('lut', error);
      }
    }

    if (this.effects.lensDistortion.enabled) {
      source = lensDistortionNode(source, uniform(Number(this.effects.lensDistortion.amount ?? 0.035)));
    }

    if (this.effects.sharpness.enabled) {
      try {
        source = sharpen(source, Number(this.effects.sharpness.amount ?? 0.25));
      } catch (error) {
        this.effectFailure('sharpness', error);
      }
    }

    if (this.effects.fxaa.enabled) {
      try {
        source = fxaa(source);
      } catch (error) {
        this.effectFailure('fxaa', error);
      }
    } else if (this.effects.smaa.enabled) {
      try {
        source = smaa(source);
      } catch (error) {
        this.effectFailure('smaa', error);
      }
    }

    this.finalNode = source;
    this.debugNodes.set('final', source);
    this.applyOutputSelection();
    pipeline.needsUpdate = true;
    this.warnings.delete('pipeline');
    this.dispatchEvent(new CustomEvent('pipeline-rebuilt', { detail: { reason } }));
  }

  private applyOutputSelection() {
    if (!this.renderPipeline) return;
    const selected = this.debugNodes.get(this.debugView) ?? this.finalNode;
    this.renderPipeline.outputNode =
      this.debugView === 'final' && this.compareEnabled
        ? beforeAfterNode(this.beforeNode, this.finalNode, this.compareSplit)
        : selected;
    this.renderPipeline.needsUpdate = true;
  }

  private effectFailure(effect: EffectName, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.effects[effect].enabled = false;
    this.warn(effect, `${effect} was isolated and disabled: ${message}`);
    this.dispatchEvent(new CustomEvent('error', { detail: { effect, error } }));
  }

  private warn(key: string, message: string) {
    this.warnings.set(key, message);
    this.dispatchEvent(new CustomEvent('warning', { detail: { effect: key, message } }));
  }

  private disposePipeline() {
    for (const node of this.nodes.splice(0)) disposeUnknown(node);
    disposeUnknown(this.renderPipeline);
    this.renderPipeline = null;
  }

  private queuePipelineRebuild(reason: string) {
    if (this.rebuildQueued || this.disposed) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.buildPipeline(reason);
    });
  }

  resetTemporal(reason = 'manual') {
    this.queuePipelineRebuild(reason);
  }

  setEffect(effect: EffectName, settings: Partial<EffectsState[EffectName]>) {
    this.effects = mergeEffectSettings(this.effects, effect, settings);
    if (effect === 'gradualBackground') this.updateBackground();
    this.queuePipelineRebuild(`effect:${effect}`);
  }

  setQualityPreset(quality: QualityPresetName) {
    this.quality = quality;
    this.effects = createQualityPreset(quality);
    this.updateBackground();
    this.queuePipelineRebuild(`quality:${quality}`);
  }

  getQualityPreset() {
    return this.quality;
  }

  setAnimationEnabled(enabled: boolean) {
    this.animationEnabled = enabled;
    if (!enabled) this.resetTemporal('animation-stopped');
  }

  getAnimationEnabled() {
    return this.animationEnabled;
  }

  getEffects(): EffectsState {
    return structuredClone(this.effects);
  }

  setDebugView(view: DebugView) {
    this.debugView = view;
    this.applyOutputSelection();
  }

  getDebugView() {
    return this.debugView;
  }

  setComparison(enabled: boolean, split = 0.5) {
    this.compareEnabled = enabled;
    this.compareSplit.value = Math.max(0.05, Math.min(0.95, split));
    this.applyOutputSelection();
  }

  setComparisonSplit(split: number) {
    this.compareSplit.value = Math.max(0.05, Math.min(0.95, split));
  }

  getMetrics(): ViewerMetrics {
    return cloneMetrics(this.metrics);
  }

  getWarnings() {
    return [...this.warnings.values()];
  }

  async loadModel(url: string) {
    if (url.startsWith('procedural:')) {
      this.replaceWithProceduralModel(url.slice('procedural:'.length));
      this.resetTemporal('model-switch');
      return;
    }

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    disposeObject3D(this.modelRoot);
    this.modelRoot.clear();

    const model = gltf.scene;
    model.traverse((object: any) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(2.6 / maxDimension);
    model.position.sub(center.multiplyScalar(model.scale.x));
    model.position.y -= new THREE.Box3().setFromObject(model).min.y;
    this.modelRoot.add(model);
    this.resetTemporal('model-switch');
  }

  private replaceWithProceduralModel(kind = 'material-study') {
    disposeObject3D(this.modelRoot);
    this.modelRoot.clear();

    const material = new THREE.MeshPhysicalMaterial({
      color: kind === 'chrome' ? '#e2e8f0' : '#d6b98c',
      metalness: kind === 'matte' ? 0.05 : 0.82,
      roughness: kind === 'matte' ? 0.78 : 0.2,
      clearcoat: 0.55,
      clearcoatRoughness: 0.15,
    });
    const geometry =
      kind === 'sphere'
        ? new THREE.SphereGeometry(1.25, 96, 48)
        : new THREE.TorusKnotGeometry(0.95, 0.32, 192, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 1.25;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.modelRoot.add(mesh);
  }

  async loadEnvironment(url: string) {
    if (!url || url === 'studio' || url.startsWith('procedural:')) {
      await this.setStudioEnvironment(true);
      return;
    }

    disposeUnknown(this.environmentResource);
    const loader = /\.exr($|\?)/i.test(url) ? new EXRLoader() : new HDRLoader();
    const texture = await loader.loadAsync(url);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    this.environmentResource = texture;
    this.scene.environment = texture;
    this.scene.background = this.effects.gradualBackground.enabled ? null : texture;
    this.updateBackground();
    this.resetTemporal('environment-switch');
  }

  private async setStudioEnvironment(resetHistory: boolean) {
    disposeUnknown(this.environmentResource);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.environmentResource = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.75;
    this.updateBackground();
    if (resetHistory) this.resetTemporal('environment-switch');
  }

  private updateBackground() {
    if (this.effects.gradualBackground.enabled) {
      this.scene.background = null;
      this.scene.backgroundNode = gradualBackgroundNode();
    } else {
      this.scene.backgroundNode = null;
      this.scene.background = this.scene.environment ?? new THREE.Color('#111827');
    }
  }

  setMaterialTextures(inputs: MaterialTextureInputs) {
    void this.applyMaterialTextures(inputs);
  }

  private async applyMaterialTextures(inputs: MaterialTextureInputs) {
    const entries = await Promise.all(
      Object.entries(inputs).map(async ([key, input]) => {
        if (!input) return [key, null] as const;
        if (typeof input !== 'string') return [key, input] as const;
        const texture = await textureLoader.loadAsync(input);
        texture.colorSpace = key === 'baseColor' || key === 'emissive' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        this.materialTextures.add(texture);
        return [key, texture] as const;
      }),
    );
    const textures = Object.fromEntries(entries) as Record<string, THREE.Texture | null>;

    this.modelRoot.traverse((object: any) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) continue;
        if ('baseColor' in textures) material.map = textures.baseColor;
        if ('normal' in textures) material.normalMap = textures.normal;
        if ('roughness' in textures) material.roughnessMap = textures.roughness;
        if ('metalness' in textures) material.metalnessMap = textures.metalness;
        if ('ao' in textures) material.aoMap = textures.ao;
        if ('emissive' in textures) material.emissiveMap = textures.emissive;
        material.needsUpdate = true;
      }
    });
    this.resetTemporal('material-textures');
  }

  async capture(options: CaptureOptions = {}): Promise<Blob> {
    const mimeType = options.mimeType ?? 'image/png';
    const quality = options.quality ?? 0.92;
    const scale = Math.max(1, Math.min(4, options.scale ?? (this.quality === 'capture' ? 2 : 1)));
    const width = this.metrics.width;
    const height = this.metrics.height;

    if (scale !== 1) {
      this.renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.buildPipeline('capture-resize');
    }

    this.renderPipeline.render();
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Canvas capture failed.'))), mimeType, quality);
    });

    if (scale !== 1) {
      this.renderer.setSize(width, height, false);
      this.buildPipeline('capture-restore');
    }

    return blob;
  }

  async runStressTest(name: 'resize' | 'toggle' | 'model' | 'environment', iterations: number): Promise<StressResult> {
    const before = this.getMetrics();
    const started = performance.now();

    if (name === 'resize') {
      const width = Math.max(320, before.width);
      const height = Math.max(240, before.height);
      for (let index = 0; index < iterations; index += 1) {
        this.renderer.setSize(width + (index % 2), height + (index % 3), false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
      this.renderer.setSize(width, height, false);
      this.buildPipeline('stress-resize');
    } else if (name === 'toggle') {
      const original = this.effects.bloom.enabled;
      for (let index = 0; index < iterations; index += 1) {
        this.effects.bloom.enabled = index % 2 === 0;
        this.buildPipeline('stress-toggle');
        this.renderPipeline.render();
      }
      this.effects.bloom.enabled = original;
      this.buildPipeline('stress-toggle-restore');
    } else if (name === 'model') {
      for (let index = 0; index < iterations; index += 1) {
        this.replaceWithProceduralModel(index % 2 === 0 ? 'chrome' : 'matte');
        this.buildPipeline('stress-model');
        this.renderPipeline.render();
      }
    } else {
      for (let index = 0; index < iterations; index += 1) {
        await this.setStudioEnvironment(false);
        this.buildPipeline('stress-environment');
        this.renderPipeline.render();
      }
    }

    this.renderPipeline.render();
    const after = this.getMetrics();
    const textureDelta = after.textures - before.textures;
    const renderTargetDelta = after.renderTargets - before.renderTargets;
    return {
      name,
      iterations,
      before,
      after,
      textureDelta,
      renderTargetDelta,
      passed: textureDelta <= 4 && renderTargetDelta <= 4,
      durationMs: performance.now() - started,
    };
  }

  resetView() {
    this.camera.position.set(4.8, 3.2, 6.6);
    this.controls.target.set(0, 0.9, 0);
    this.controls.update();
    this.resetTemporal('reset-view');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.disposePipeline();
    disposeObject3D(this.scene);
    disposeUnknown(this.environmentResource);
    this.lutTexture.dispose();
    for (const texture of this.materialTextures) texture.dispose();
    this.materialTextures.clear();
    this.renderer?.dispose();
    this.dispatchEvent(new CustomEvent('disposed'));
  }
}

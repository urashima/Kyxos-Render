import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  convertToTexture,
  dot,
  exp,
  float,
  interleavedGradientNoise,
  max,
  mix,
  rand,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  smoothstep,
  time,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import type { ScreenSpaceSSSQuality } from '../types';
import { screenSpaceSSSTemporalResolve } from './screenSpaceSSSTemporalNode';

type KernelTap = { offset: number; weight: number };
export type ScreenSpaceSSSOutputMode =
  | 'composite'
  | 'diffusion'
  | 'translucency'
  | 'stochastic'
  | 'temporal';

// These are the normalized profiles used by the previous deterministic
// separable implementation. The stochastic path importance-selects one radial
// pair from the same profile per sample pair, so its temporal mean converges to
// the same target rather than introducing a new diffusion curve.
const KERNELS: Record<ScreenSpaceSSSQuality, KernelTap[]> = {
  low: [
    { offset: 0, weight: 0.42 },
    { offset: 0.5, weight: 0.24 },
    { offset: 1, weight: 0.05 },
  ],
  medium: [
    { offset: 0, weight: 0.382 },
    { offset: 0.333333, weight: 0.242 },
    { offset: 0.666667, weight: 0.061 },
    { offset: 1, weight: 0.006 },
  ],
  high: [
    { offset: 0, weight: 0.382 },
    { offset: 0.333333, weight: 0.242 },
    { offset: 0.666667, weight: 0.061 },
    { offset: 1, weight: 0.006 },
  ],
};

const SAMPLE_PAIRS: Record<ScreenSpaceSSSQuality, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// Radius is exposed to artists in full-resolution screen pixels at this
// reference view depth. When the stochastic RTT runs below full resolution the
// radius is scaled with the RTT so the final reconstructed footprint is stable.
const REFERENCE_VIEW_DEPTH = 8;
const TRANSLUCENCY_GAIN = 0.22;
const HIGH_BROAD_LOBE_PROBABILITY = 0.42;
const HIGH_BROAD_LOBE_SCALE = 2.4;

export function getScreenSpaceSSSSamplesPerFrame(quality: ScreenSpaceSSSQuality) {
  return SAMPLE_PAIRS[quality] * 2;
}

export interface ScreenSpaceSSSNodeOptions {
  color: string;
  strength: number;
  radius: number;
  falloff: readonly [number, number, number];
  depthFalloff: number;
  normalThreshold: number;
  quality: ScreenSpaceSSSQuality;
  resolutionScale: number;
  temporalFiltering: boolean;
  temporalMaxFrames: number;
  temporalClamp: number;
  temporalFlickerSuppression: number;
  outputMode?: ScreenSpaceSSSOutputMode;
}

export interface ScreenSpaceSSSNodeResult {
  outputNode: any;
  currentNode: any;
  temporalNode: any;
  resources: any[];
  samplesPerFrame: number;
}

function selectKernelOffset(kernel: KernelTap[], randomValue: any) {
  const radialTaps = kernel.slice(1);
  const nonCenterMass = radialTaps.reduce((sum, tap) => sum + tap.weight * 2, 0);
  let cumulative = (radialTaps[0].weight * 2) / nonCenterMass;
  let selectedOffset: any = float(radialTaps[0].offset);

  for (let index = 1; index < radialTaps.length; index += 1) {
    selectedOffset = select(
      randomValue.greaterThan(cumulative),
      float(radialTaps[index].offset),
      selectedOffset,
    );
    cumulative += (radialTaps[index].weight * 2) / nonCenterMass;
  }

  return selectedOffset;
}

/**
 * Builds one independent material-masked stochastic screen-space SSS graph.
 *
 * Low/Medium/High evaluate 2/4/6 color taps per sampled pixel and frame. Each
 * pair importance-selects a radius from the published target profile and
 * rotates that pair with interleaved-gradient and per-frame random noise. The
 * stochastic pass can run below full resolution; an ordered temporal pass uses
 * Three.js TemporalReprojectNode for motion reprojection, geometry validation
 * and YCoCg variance clipping, then explicitly mixes the current sample into
 * feedback with motion-adaptive weighting.
 *
 * Each invocation produces exactly one output graph. Final composition and
 * debug views must not share an invoked Fn node: Three.js TSL assignment stacks
 * are graph-local, and reusing a shader-call output across RenderPipeline graphs
 * can produce `No stack defined for assign operation` and black output.
 *
 * sssData layout: R = material mask, G = thickness, B = roughness.
 * surface layout: RGB = base color, A = metalness.
 */
export function createScreenSpaceSSSNode(
  colorNode: any,
  depthNode: any,
  viewZNode: any,
  normalPackedNode: any,
  velocityNode: any,
  sssDataNode: any,
  surfaceNode: any,
  camera: THREE.Camera,
  options: ScreenSpaceSSSNodeOptions,
): ScreenSpaceSSSNodeResult {
  const resources: any[] = [];
  const sourceTexture = convertToTexture(colorNode);
  if (sourceTexture !== colorNode) resources.push(sourceTexture);

  const radius = uniform(options.radius);
  const resolutionScale = uniform(options.resolutionScale);
  const depthFalloff = uniform(options.depthFalloff);
  const normalThreshold = uniform(options.normalThreshold);
  const scatteringColor = uniform(new THREE.Color(options.color));
  const channelFalloff = uniform(new THREE.Vector3(...options.falloff));
  const strength = uniform(options.strength);
  const kernel = KERNELS[options.quality];
  const samplePairs = SAMPLE_PAIRS[options.quality];
  const centerWeight = kernel[0].weight;
  const nonCenterMass = 1 - centerWeight;
  const outputMode = options.outputMode ?? 'composite';

  const stochasticFilter = Fn(() => {
    const uv = screenUV;
    const centerColor = sourceTexture.sample(uv).toVar();
    const centerData = sssDataNode.sample(uv).toVar();
    const centerSurface = surfaceNode.sample(uv).toVar();
    const centerMask = centerData.r.saturate();
    const centerThickness = max(centerData.g, 0.01);
    const centerDepth = viewZNode.sample(uv);
    const centerNormal = unpackRGBToNormal(normalPackedNode.sample(uv).rgb);

    const perspectiveScale = float(REFERENCE_VIEW_DEPTH)
      .div(max(abs(centerDepth), 1))
      .clamp(0.5, 2);
    const thicknessScale = mix(0.5, 1, centerThickness.saturate());
    const projectedRadius = radius
      .mul(resolutionScale)
      .mul(thicknessScale)
      .mul(perspectiveScale)
      .clamp(0.125, 48);
    // Temporal filtering requires a changing stochastic sequence. Without a
    // history resolve, keep the pattern fixed so disabling the switch does not
    // turn into an uncontrolled full-frame shimmer mode.
    const frameSeed = options.temporalFiltering ? time.mul(60).floor() : float(0);
    const accumulated = vec3(0).toVar();

    const sampleSurface = (sampleUv: any) => {
      const sampleData = sssDataNode.sample(sampleUv);
      const sampleMask = sampleData.r.saturate();
      const sampleDepth = viewZNode.sample(sampleUv);
      const sampleNormal = unpackRGBToNormal(normalPackedNode.sample(sampleUv).rgb);
      const sampleMaterial = surfaceNode.sample(sampleUv);

      const relativeDepthDelta = abs(sampleDepth.sub(centerDepth)).div(max(abs(centerDepth), 0.35));
      const depthWeight = exp(relativeDepthDelta.mul(depthFalloff).mul(-1));
      const normalWeight = smoothstep(normalThreshold, 1, dot(centerNormal, sampleNormal));
      const albedoDelta = dot(abs(sampleMaterial.rgb.sub(centerSurface.rgb)), vec3(0.333333));
      const albedoWeight = exp(albedoDelta.mul(-4));
      const thicknessWeight = max(float(0.1), float(1).sub(abs(sampleData.g.sub(centerThickness))));
      const edgeWeight = centerMask
        .mul(sampleMask)
        .mul(depthWeight)
        .mul(normalWeight)
        .mul(albedoWeight)
        .mul(thicknessWeight);

      return {
        color: sourceTexture.sample(sampleUv).rgb,
        weight: edgeWeight,
      };
    };

    for (let pairIndex = 0; pairIndex < samplePairs; pairIndex += 1) {
      const pairSeed = float(pairIndex + 1);
      const spatialNoise = interleavedGradientNoise(
        screenCoordinate.add(vec2(pairIndex * 19.19, pairIndex * 7.73)),
      );
      const angleNoise = spatialNoise
        .add(
          rand(
            uv
              .mul(vec2(127.1 + pairIndex * 11.7, 311.7 + pairIndex * 17.3))
              .add(frameSeed.mul(0.754877666))
              .add(pairSeed),
          ),
        )
        .fract();
      const radiusNoise = rand(
        uv
          .mul(vec2(269.5 + pairIndex * 13.1, 183.3 + pairIndex * 9.7))
          .add(frameSeed.mul(1.324717957))
          .add(pairSeed.mul(3.17)),
      );
      const selectedRadius = selectKernelOffset(kernel, radiusNoise);
      const angle = angleNoise.mul(Math.PI * 2);
      const direction = vec2(angle.cos(), angle.sin());

      let lobeScale: any = float(1);
      if (options.quality === 'high') {
        const lobeNoise = rand(
          uv
            .mul(vec2(419.2 + pairIndex * 5.3, 371.9 + pairIndex * 3.1))
            .add(frameSeed.mul(0.618033989))
            .add(pairSeed.mul(5.11)),
        );
        lobeScale = select(
          lobeNoise.lessThan(HIGH_BROAD_LOBE_PROBABILITY),
          float(HIGH_BROAD_LOBE_SCALE),
          float(1),
        );
      }

      const texelOffset = direction
        .div(screenSize)
        .mul(projectedRadius)
        .mul(selectedRadius)
        .mul(lobeScale);
      const positive = sampleSurface(uv.add(texelOffset).clamp(0, 1));
      const negative = sampleSurface(uv.sub(texelOffset).clamp(0, 1));
      const pairWeight = positive.weight.add(negative.weight);
      const pairColor = positive.color
        .mul(positive.weight)
        .add(negative.color.mul(negative.weight))
        .add(centerColor.rgb.mul(0.0001))
        .div(pairWeight.add(0.0001));
      const estimate = centerColor.rgb
        .mul(centerWeight)
        .add(pairColor.mul(nonCenterMass));
      accumulated.addAssign(estimate);
    }

    const filtered = accumulated.div(samplePairs);
    return vec4(mix(centerColor.rgb, filtered, centerMask), centerColor.a);
  })();

  const currentTexture = convertToTexture(stochasticFilter);
  if (typeof currentTexture.setResolutionScale === 'function') {
    currentTexture.setResolutionScale(options.resolutionScale);
  }
  resources.push(currentTexture);

  let resolved: any = currentTexture;
  if (options.temporalFiltering) {
    const temporal = screenSpaceSSSTemporalResolve(
      currentTexture,
      depthNode,
      normalPackedNode,
      velocityNode,
      camera,
      {
        maxFrames: options.temporalMaxFrames,
        clampIntensity: options.temporalClamp,
        flickerSuppression: options.temporalFlickerSuppression,
      },
    );
    resolved = temporal;
    resources.push(temporal);
  }

  const outputNode = Fn(() => {
    const uv = screenUV;
    const source = sourceTexture.sample(uv);
    const current = currentTexture.sample(uv).rgb;
    const scattered = resolved.rgb;
    const data = sssDataNode.sample(uv);
    const surface = surfaceNode.sample(uv);
    const normal = unpackRGBToNormal(normalPackedNode.sample(uv).rgb);
    const materialMask = data.r.saturate();
    const thickness = data.g.saturate();
    const roughness = data.b.saturate();
    const metalness = surface.a.saturate();

    const diffuseShare = materialMask
      .mul(float(1).sub(metalness))
      .mul(mix(0.45, 1, roughness))
      .saturate();
    const channelStrength = scatteringColor.rgb
      .mul(channelFalloff)
      .mul(strength)
      .mul(diffuseShare)
      .saturate();
    const diffusion = scattered.sub(source.rgb).mul(channelStrength);

    const grazing = float(1).sub(abs(normal.z)).saturate();
    const transmissionProfile = grazing.mul(grazing).mul(thickness);
    const translucency = scattered
      .mul(channelStrength)
      .mul(transmissionProfile)
      .mul(TRANSLUCENCY_GAIN);

    if (outputMode === 'stochastic') return vec4(current, 1);
    if (outputMode === 'temporal') return vec4(scattered, 1);
    if (outputMode === 'diffusion') return vec4(diffusion, 1);
    if (outputMode === 'translucency') return vec4(translucency, 1);
    return vec4(diffusion.add(translucency), 0);
  })();

  return {
    outputNode,
    currentNode: currentTexture,
    temporalNode: resolved,
    resources,
    samplesPerFrame: getScreenSpaceSSSSamplesPerFrame(options.quality),
  };
}

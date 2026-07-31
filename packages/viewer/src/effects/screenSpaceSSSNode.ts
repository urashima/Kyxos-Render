import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  convertToTexture,
  dot,
  exp,
  float,
  max,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import type { ScreenSpaceSSSQuality } from '../types';

type KernelTap = { offset: number; weight: number };

// The medium/high kernel is the normalized seven-tap profile published with
// Jimenez and Gutierrez' separable screen-space SSS work. Low keeps the same
// symmetric shape with five taps. High evaluates an additional broad lobe.
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

// Radius is exposed to artists in screen-space pixels at this reference view
// depth. Perspective scaling keeps the effect plausible without shrinking the
// configured radius to a sub-pixel value at normal presentation distances.
const REFERENCE_VIEW_DEPTH = 8;
const TRANSLUCENCY_GAIN = 0.22;

export interface ScreenSpaceSSSNodeOptions {
  color: string;
  strength: number;
  radius: number;
  falloff: readonly [number, number, number];
  depthFalloff: number;
  normalThreshold: number;
  quality: ScreenSpaceSSSQuality;
}

export interface ScreenSpaceSSSNodeResult {
  deltaNode: any;
  diffusionNode: any;
  translucencyNode: any;
  resources: any[];
}

/**
 * Builds a separable, material-masked screen-space diffusion correction.
 *
 * sssData layout: R = material mask, G = thickness, B = roughness.
 * surface layout: RGB = base color, A = metalness.
 */
export function createScreenSpaceSSSNode(
  colorNode: any,
  viewZNode: any,
  normalPackedNode: any,
  sssDataNode: any,
  surfaceNode: any,
  options: ScreenSpaceSSSNodeOptions,
): ScreenSpaceSSSNodeResult {
  const resources: any[] = [];
  const sourceTexture = convertToTexture(colorNode);
  if (sourceTexture !== colorNode) resources.push(sourceTexture);

  const radius = uniform(options.radius);
  const depthFalloff = uniform(options.depthFalloff);
  const normalThreshold = uniform(options.normalThreshold);
  const scatteringColor = uniform(new THREE.Color(options.color));
  const channelFalloff = uniform(new THREE.Vector3(...options.falloff));
  const strength = uniform(options.strength);
  const kernel = KERNELS[options.quality];

  const blurPass = (inputTexture: any, directionX: number, directionY: number, radiusScale: number) =>
    Fn(() => {
      const uv = screenUV;
      const centerColor = inputTexture.sample(uv).toVar();
      const centerData = sssDataNode.sample(uv).toVar();
      const centerSurface = surfaceNode.sample(uv).toVar();
      const centerMask = centerData.r.saturate();
      const centerThickness = max(centerData.g, 0.01);
      const centerDepth = viewZNode.sample(uv);
      const centerNormal = unpackRGBToNormal(normalPackedNode.sample(uv).rgb);

      // `radius` is a pixel-space control. Thickness modulates the profile from
      // 50% to 100% instead of multiplying it directly: the old formulation made
      // the default 0.55 thickness silently halve an already perspective-scaled
      // radius, leaving the toggle visually indistinguishable.
      const perspectiveScale = float(REFERENCE_VIEW_DEPTH)
        .div(max(abs(centerDepth), 1))
        .clamp(0.5, 2);
      const thicknessScale = mix(0.5, 1, centerThickness.saturate());
      const projectedRadius = radius
        .mul(thicknessScale)
        .mul(radiusScale)
        .mul(perspectiveScale)
        .clamp(0.25, 48);
      const texelOffset = vec2(directionX, directionY).div(screenSize).mul(projectedRadius);
      const colorSum = vec3(centerColor.rgb.mul(kernel[0].weight)).toVar();
      const weightSum = float(kernel[0].weight).toVar();

      for (let index = 1; index < kernel.length; index += 1) {
        const tap = kernel[index];

        for (const sign of [-1, 1]) {
          const sampleUv = uv.add(texelOffset.mul(tap.offset * sign)).clamp(0, 1);
          const sampleData = sssDataNode.sample(sampleUv);
          const sampleMask = sampleData.r.saturate();
          const sampleDepth = viewZNode.sample(sampleUv);
          const sampleNormal = unpackRGBToNormal(normalPackedNode.sample(sampleUv).rgb);
          const sampleSurface = surfaceNode.sample(sampleUv);

          const relativeDepthDelta = abs(sampleDepth.sub(centerDepth)).div(max(abs(centerDepth), 0.35));
          const depthWeight = exp(relativeDepthDelta.mul(depthFalloff).mul(-1));
          const normalWeight = smoothstep(normalThreshold, 1, dot(centerNormal, sampleNormal));
          const albedoDelta = dot(abs(sampleSurface.rgb.sub(centerSurface.rgb)), vec3(0.333333));
          const albedoWeight = exp(albedoDelta.mul(-4));
          const thicknessWeight = max(float(0.1), float(1).sub(abs(sampleData.g.sub(centerThickness))));
          const edgeWeight = centerMask
            .mul(sampleMask)
            .mul(depthWeight)
            .mul(normalWeight)
            .mul(albedoWeight)
            .mul(thicknessWeight);
          const tapWeight = edgeWeight.mul(tap.weight);

          colorSum.addAssign(inputTexture.sample(sampleUv).rgb.mul(tapWeight));
          weightSum.addAssign(tapWeight);
        }
      }

      const filtered = colorSum.div(max(weightSum, 0.0001));
      return vec4(mix(centerColor.rgb, filtered, centerMask), centerColor.a);
    })();

  const horizontal = convertToTexture(blurPass(sourceTexture, 1, 0, 1));
  resources.push(horizontal);
  const narrow = blurPass(horizontal, 0, 1, 1);

  let filtered: any = narrow;
  if (options.quality === 'high') {
    const broadHorizontal = convertToTexture(blurPass(sourceTexture, 1, 0, 2.4));
    resources.push(broadHorizontal);
    const broad = blurPass(broadHorizontal, 0, 1, 2.4);
    filtered = mix(narrow, broad, 0.42);
  }

  const diffusionNode = Fn(() => {
    const uv = screenUV;
    const source = sourceTexture.sample(uv);
    const scattered = filtered;
    const data = sssDataNode.sample(uv);
    const surface = surfaceNode.sample(uv);
    const materialMask = data.r.saturate();
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

    return vec4(scattered.rgb.sub(source.rgb).mul(channelStrength), 1);
  })();

  const translucencyNode = Fn(() => {
    const uv = screenUV;
    const scattered = filtered;
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
    const grazing = float(1).sub(abs(normal.z)).saturate();
    const transmissionProfile = grazing.mul(grazing).mul(thickness);
    const transmission = scattered.rgb
      .mul(channelStrength)
      .mul(transmissionProfile)
      .mul(TRANSLUCENCY_GAIN);

    return vec4(transmission, 1);
  })();

  const deltaNode = Fn(() => vec4(diffusionNode.rgb.add(translucencyNode.rgb), 0))();

  return { deltaNode, diffusionNode, translucencyNode, resources };
}

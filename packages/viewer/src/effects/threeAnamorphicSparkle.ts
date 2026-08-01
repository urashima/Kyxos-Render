import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  float,
  luminance,
  mix,
  rtt,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
  viewportSize,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

function asNode(value: any, fallback: number) {
  return value?.isNode ? value : uniform(Number(value ?? fallback));
}

/**
 * Three.js official WebGPU anamorphic lensflare implementation adapted from:
 * examples/webgpu_postprocessing_anamorphic.html
 *
 * The algorithm and defaults intentionally mirror the official example instead
 * of maintaining a Kyxos-specific procedural sparkle shader.
 */
export function threeAnamorphicSparkleNode(
  source: any,
  intensity: any = 5,
  threshold: any = 0.3,
  radius: any = 0,
  sampleCount: any = 80,
) {
  const intensityNode = asNode(intensity, 5);
  const tintColor = uniform(new THREE.Color(0x7a8aff));
  const thresholdNode = asNode(threshold, 0.3);
  const radiusNode = asNode(radius, 0);
  const samples = asNode(sampleCount, 80);

  const bloomPass = bloom(source, intensityNode, radiusNode, thresholdNode);
  bloomPass.setResolutionScale(0.25);

  // Copied from the official Three.js anamorphic post-processing example.
  bloomPass.highPassFn = Fn(({ input, threshold, smoothWidth }: any) => {
    const v = luminance(input.rgb);
    const alpha = smoothstep(threshold, threshold.add(smoothWidth), v);
    const brightPass = rtt(mix(vec4(0), input, alpha), null, null, {
      wrapS: THREE.MirroredRepeatWrapping,
      wrapT: THREE.MirroredRepeatWrapping,
    });

    const total = vec4(0);
    const halfSamples = samples.div(2);
    const invSize = vec2(1).div(viewportSize);

    Loop({ start: halfSamples.negate(), end: halfSamples }, ({ i }: any) => {
      let softness = float(i).abs().div(halfSamples).oneMinus();
      softness = softness.pow(2);
      const shiftedUV = vec2(uv().x.add(invSize.x.mul(i).mul(4)), uv().y);
      total.addAssign(brightPass.sample(shiftedUV).mul(softness));
    });

    return total.div(samples.div(3));
  });

  return bloomPass.mul(tintColor);
}

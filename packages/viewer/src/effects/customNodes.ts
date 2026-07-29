import {
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three/webgpu';
import {
  Fn,
  abs,
  color,
  convertToTexture,
  dot,
  float,
  fract,
  mix,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export function gradualBackgroundNode() {
  const horizon = smoothstep(0.05, 0.95, screenUV.y);
  return mix(color(0x111827), color(0x64748b), horizon);
}

export function lensDistortionNode(source: any, amount: any) {
  const textureNode = convertToTexture(source);
  return Fn(() => {
    const centered = screenUV.sub(0.5).toVar();
    const radiusSquared = dot(centered, centered);
    const scale = float(1).add(amount.mul(radiusSquared));
    const distortedUv = centered.mul(scale).add(0.5).clamp(0, 1);
    return textureNode.sample(distortedUv);
  })();
}

export function sparkleNode(source: any, intensity: any, threshold: any) {
  const textureNode = convertToTexture(source);
  return Fn(() => {
    const base = textureNode.sample(screenUV).toVar();
    const luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722)).saturate();
    const cell = screenUV.mul(vec2(920, 520)).floor();
    const noise = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453).add(time.mul(0.75)));
    const gate = step(threshold, noise.mul(luma.pow(5)));
    const horizontal = smoothstep(0.035, 0, abs(fract(screenUV.x.mul(920)).sub(0.5)));
    const vertical = smoothstep(0.035, 0, abs(fract(screenUV.y.mul(520)).sub(0.5)));
    const sparkle = gate.mul(horizontal.add(vertical)).mul(intensity);
    return vec4(base.rgb.add(vec3(sparkle)), base.a);
  })();
}

export function beforeAfterNode(before: any, after: any, split: any) {
  return Fn(() => {
    const side = step(split, screenUV.x);
    const combined = mix(before, after, side);
    const divider = float(1).sub(step(0.0025, abs(screenUV.x.sub(split))));
    return mix(combined, vec4(1, 1, 1, 1), divider);
  })();
}

export function createWarmLutTexture(size = 16): Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  let offset = 0;

  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const r = red / (size - 1);
        const g = green / (size - 1);
        const b = blue / (size - 1);
        const contrast = (value: number) => Math.min(1, Math.max(0, (value - 0.5) * 1.08 + 0.5));
        data[offset++] = Math.round(contrast(r * 1.035) * 255);
        data[offset++] = Math.round(contrast(g * 1.005) * 255);
        data[offset++] = Math.round(contrast(b * 0.955) * 255);
        data[offset++] = 255;
      }
    }
  }

  const texture = new Data3DTexture(data, size, size, size);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  texture.name = 'Kyxos.WarmLUT';
  return texture;
}

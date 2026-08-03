import type {
  BackendPreference,
  QualityPreset,
  SceneEffectName,
  SceneEffectSettings,
  SceneRenderSettings,
} from './index';

export type RenderControlKind = 'number' | 'boolean';

export interface RenderParameterDefinition {
  key: string;
  label: string;
  kind: RenderControlKind;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface RenderOption<T extends string = string> {
  value: T;
  label: string;
}

export type CanonicalEffectState = Record<SceneEffectName, SceneEffectSettings>;

export const RENDER_BACKEND_OPTIONS: readonly RenderOption<BackendPreference>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'webgl2', label: 'WebGL 2' },
];

export const RENDER_QUALITY_OPTIONS: readonly RenderOption<QualityPreset>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'capture', label: 'Capture' },
];

export const RENDER_TONE_MAPPING_OPTIONS: readonly RenderOption[] = [
  { value: 'AgX', label: 'AgX' },
  { value: 'ACES', label: 'ACES' },
  { value: 'Neutral', label: 'Neutral' },
  { value: 'Linear', label: 'Linear' },
  { value: 'Reinhard', label: 'Reinhard' },
];

export const RENDER_EFFECT_ORDER: readonly SceneEffectName[] = [
  'traa',
  'fxaa',
  'smaa',
  'ssaa',
  'gtao',
  'ssao',
  'ssr',
  'ssgi',
  'temporalReprojection',
  'poissonDenoise',
  'temporalDenoise',
  'motionBlur',
  'bloom',
  'dof',
  'lut',
  'lensDistortion',
  'sharpness',
  'sparkle',
  'gradualBackground',
];

export const RENDER_EFFECT_LABELS: Readonly<Record<SceneEffectName, string>> = {
  traa: 'TRAA',
  fxaa: 'FXAA',
  smaa: 'SMAA',
  ssaa: 'SSAA Capture',
  gtao: 'GTAO',
  ssao: 'SSAO',
  ssr: 'SSR',
  ssgi: 'SSGI',
  temporalReprojection: 'SSR Temporal Reprojection',
  poissonDenoise: 'Poisson Denoise',
  temporalDenoise: 'SSR Recurrent Denoise',
  motionBlur: 'Motion Blur',
  bloom: 'Bloom',
  dof: 'Depth of Field',
  lut: 'LUT / Color Grade',
  lensDistortion: 'Lens Distortion',
  sharpness: 'Sharpness',
  sparkle: 'Sparkle · Three.js Anamorphic',
  gradualBackground: 'Gradual Background',
};

const number = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  description?: string,
): RenderParameterDefinition => ({ key, label, kind: 'number', min, max, step, description });

const toggle = (
  key: string,
  label: string,
  description?: string,
): RenderParameterDefinition => ({ key, label, kind: 'boolean', description });

export const RENDER_EFFECT_PARAMETERS: Readonly<
  Partial<Record<SceneEffectName, readonly RenderParameterDefinition[]>>
> = {
  traa: [
    number('depthThreshold', 'Depth threshold', 0.0001, 0.004, 0.0001),
    number('edgeDepthDiff', 'Edge depth diff', 0.0001, 0.006, 0.0001),
    number('maxVelocityLength', 'Max velocity', 16, 256, 1),
  ],
  ssaa: [number('samples', 'Samples', 1, 32, 1)],
  gtao: [
    number('resolutionScale', 'Resolution', 0.25, 1, 0.25),
    number('samples', 'Samples', 4, 32, 1),
    number('radius', 'Radius', 0.1, 2, 0.05),
    number('intensity', 'Intensity', 0, 4, 0.05),
    number('thickness', 'Thickness', 0.01, 2, 0.01),
  ],
  ssao: [
    number('resolutionScale', 'Resolution', 0.25, 1, 0.25),
    number('samples', 'Samples', 4, 32, 1),
    number('radius', 'Radius', 0.1, 2, 0.05),
    number('intensity', 'Intensity', 0, 4, 0.05),
  ],
  ssr: [
    number('resolutionScale', 'Resolution', 0.25, 1, 0.25),
    number('quality', 'Quality', 0.05, 1, 0.05),
    number('intensity', 'Intensity', 0, 4, 0.05),
    number('thickness', 'Thickness', 0.01, 0.3, 0.01),
    number('maxDistance', 'Max distance', 0.05, 3, 0.05),
    number('mirrorBias', 'Mirror bias', 0, 1, 0.05),
  ],
  ssgi: [
    number('resolutionScale', 'Resolution', 0.25, 1, 0.25),
    number('sliceCount', 'Slices', 1, 4, 1),
    number('stepCount', 'Steps', 2, 32, 1),
    number('radius', 'Radius', 1, 25, 1),
    number('intensity', 'Intensity', 0, 8, 0.1),
    toggle(
      'temporalFiltering',
      'Temporal filtering',
      'Stabilizes SSGI independently while TRAA remains the full-frame anti-aliasing option.',
    ),
  ],
  temporalReprojection: [
    number('maxFrames', 'History frames', 1, 64, 1),
    number('clampIntensity', 'History clamp', 0, 2, 0.05),
    number('flickerSuppression', 'Flicker suppression', 0, 2, 0.05),
    toggle('hitPointReprojection', 'Hit-point reprojection'),
  ],
  poissonDenoise: [
    number('radius', 'Radius', 0, 5, 0.1),
    number('strength', 'Strength', 0, 2, 0.05),
  ],
  temporalDenoise: [
    number('radius', 'Radius', 0, 3, 0.05),
    number('strength', 'History strength', 0.05, 1.5, 0.025),
    number('lumaPhi', 'Luma edge stop', 0.05, 10, 0.05),
    number('depthPhi', 'Depth edge stop', 1, 50, 1),
    number('normalPhi', 'Normal edge stop', 0, 2, 0.05),
    number('roughnessPhi', 'Roughness edge stop', 1, 200, 1),
    number('alphaPhi', 'Alpha edge stop', 0, 20, 0.25),
    number('adapt', 'Adaptive blend', 0, 1, 0.05),
    number('flickerSuppression', 'Flicker suppression', 0, 2, 0.05),
    number('adaptiveTrust', 'Adaptive trust', 0, 1, 0.05),
    toggle('smoothDisocclusions', 'Smooth disocclusions'),
  ],
  motionBlur: [number('amount', 'Amount', 0, 3, 0.05)],
  bloom: [
    number('threshold', 'Threshold', 0, 2, 0.05),
    number('strength', 'Strength', 0, 3, 0.05),
    number('radius', 'Radius', 0, 1, 0.01),
  ],
  dof: [
    number('focusDistance', 'Focus distance', 0.1, 20, 0.1),
    number('focalLength', 'Focal length', 10, 200, 1),
    number('bokehScale', 'Bokeh scale', 0, 10, 0.1),
  ],
  lut: [number('intensity', 'Intensity', 0, 1, 0.01)],
  lensDistortion: [number('amount', 'Amount', -0.2, 0.2, 0.005)],
  sharpness: [number('amount', 'Amount', 0, 2, 0.05)],
  sparkle: [
    number('intensity', 'Intensity', 0, 10, 0.1),
    number('threshold', 'Threshold', 0, 0.9, 0.01),
    number('radius', 'Radius', 0, 1, 0.01),
    number('samples', 'Samples', 8, 128, 1),
  ],
  gradualBackground: [number('intensity', 'Intensity', 0, 2, 0.05)],
};

const disabled = (): CanonicalEffectState => ({
  traa: { enabled: false },
  fxaa: { enabled: false },
  smaa: { enabled: false },
  ssaa: { enabled: false, samples: 8 },
  gtao: {
    enabled: false,
    resolutionScale: 0.5,
    samples: 16,
    radius: 0.5,
    intensity: 1.2,
    thickness: 1,
  },
  ssao: {
    enabled: false,
    resolutionScale: 0.5,
    samples: 16,
    radius: 0.5,
    intensity: 1.5,
  },
  ssr: {
    enabled: false,
    resolutionScale: 0.5,
    quality: 0.25,
    intensity: 1,
    thickness: 0.1,
    maxDistance: 0.4,
    mirrorBias: 0.5,
  },
  ssgi: {
    enabled: false,
    resolutionScale: 0.5,
    sliceCount: 2,
    stepCount: 8,
    radius: 10,
    intensity: 1,
    temporalFiltering: true,
  },
  temporalReprojection: {
    enabled: false,
    maxFrames: 16,
    clampIntensity: 0.25,
    flickerSuppression: 1,
    hitPointReprojection: true,
  },
  poissonDenoise: { enabled: false, radius: 2, strength: 1 },
  temporalDenoise: {
    enabled: false,
    radius: 1.5,
    strength: 0.725,
    lumaPhi: 0.75,
    depthPhi: 20,
    normalPhi: 0.3,
    roughnessPhi: 100,
    alphaPhi: 5,
    adapt: 0.5,
    smoothDisocclusions: true,
    flickerSuppression: 1,
    adaptiveTrust: 1,
  },
  motionBlur: { enabled: false, amount: 1 },
  bloom: { enabled: false, threshold: 0.75, strength: 0.5, radius: 0.2 },
  dof: { enabled: false, focusDistance: 4, focalLength: 45, bokehScale: 1.5 },
  lut: { enabled: false, intensity: 0.65 },
  lensDistortion: { enabled: false, amount: 0.035 },
  sharpness: { enabled: false, amount: 0.25 },
  sparkle: { enabled: false, intensity: 5, threshold: 0.3, radius: 0, samples: 80 },
  gradualBackground: { enabled: true, intensity: 1 },
});

export function createCanonicalQualityPreset(name: QualityPreset): CanonicalEffectState {
  const state = disabled();

  if (name === 'low') {
    state.fxaa.enabled = true;
    state.gtao.enabled = true;
    state.gtao.resolutionScale = 0.5;
    return state;
  }

  if (name === 'medium') {
    state.traa.enabled = true;
    state.gtao.enabled = true;
    state.gtao.resolutionScale = 0.5;
    state.ssr.enabled = true;
    state.ssr.resolutionScale = 0.5;
    state.bloom.enabled = true;
    return state;
  }

  if (name === 'high') {
    state.traa.enabled = true;
    state.gtao.enabled = true;
    state.ssr.enabled = true;
    state.ssgi.enabled = true;
    state.temporalReprojection.enabled = true;
    state.temporalDenoise.enabled = true;
    state.bloom.enabled = true;
    state.lut.enabled = true;
    state.sharpness.enabled = true;
    return state;
  }

  if (name === 'cinematic') {
    state.traa.enabled = true;
    state.gtao.enabled = true;
    state.gtao.resolutionScale = 1;
    state.ssr.enabled = true;
    state.ssr.resolutionScale = 1;
    state.ssr.quality = 0.75;
    state.ssgi.enabled = true;
    state.ssgi.resolutionScale = 1;
    state.ssgi.sliceCount = 4;
    state.ssgi.stepCount = 16;
    state.temporalReprojection.enabled = true;
    state.temporalDenoise.enabled = true;
    state.motionBlur.enabled = true;
    state.bloom.enabled = true;
    state.dof.enabled = true;
    state.lut.enabled = true;
    state.lensDistortion.enabled = true;
    state.sharpness.enabled = true;
    return state;
  }

  // Preserve the existing Viewer behavior: both Ultra and Capture use the
  // deterministic SSAA capture stack.
  state.ssaa.enabled = true;
  state.ssaa.samples = 8;
  state.bloom.enabled = true;
  state.dof.enabled = true;
  state.lut.enabled = true;
  state.lensDistortion.enabled = true;
  state.sharpness.enabled = true;
  return state;
}

const aaEffects: SceneEffectName[] = ['traa', 'fxaa', 'smaa', 'ssaa'];

export function enforceCanonicalEffectRules(
  state: CanonicalEffectState,
  changed?: SceneEffectName,
): CanonicalEffectState {
  const next = structuredClone(state);

  if (changed && aaEffects.includes(changed) && next[changed].enabled) {
    for (const name of aaEffects) {
      if (name !== changed) next[name].enabled = false;
    }
  }

  const active = aaEffects.filter((name) => next[name].enabled);
  if (active.length > 1) {
    const keep = changed && active.includes(changed) ? changed : active[0];
    for (const name of active) next[name].enabled = name === keep;
  }

  if (changed === 'ssr' && !next.ssr.enabled) {
    next.temporalReprojection.enabled = false;
    next.temporalDenoise.enabled = false;
  } else {
    if (changed === 'temporalReprojection' && !next.temporalReprojection.enabled) {
      next.temporalDenoise.enabled = false;
    }
    if (next.temporalDenoise.enabled) next.temporalReprojection.enabled = true;
    if (next.temporalReprojection.enabled) next.ssr.enabled = true;
    if (!next.temporalReprojection.enabled) next.temporalDenoise.enabled = false;
  }

  if (next.ssaa.enabled) {
    next.traa.enabled = false;
    next.fxaa.enabled = false;
    next.smaa.enabled = false;
  }

  return next;
}

export function mergeCanonicalEffectSettings(
  state: CanonicalEffectState,
  effect: SceneEffectName,
  patch: Partial<SceneEffectSettings>,
): CanonicalEffectState {
  const next = structuredClone(state);
  next[effect] = { ...next[effect], ...patch };
  return enforceCanonicalEffectRules(next, effect);
}

export function resolveCanonicalEffects(settings: SceneRenderSettings): CanonicalEffectState {
  let state = createCanonicalQualityPreset(settings.qualityPreset);
  const saved = settings.effects as Record<string, SceneEffectSettings | undefined>;
  for (const name of RENDER_EFFECT_ORDER) {
    if (saved[name]) state[name] = { ...state[name], ...structuredClone(saved[name]) };
  }
  return enforceCanonicalEffectRules(state);
}

export const SCREEN_SPACE_SSS_EFFECT = 'screenSpaceSSS';

export interface ScreenSpaceSssRenderSettings extends SceneEffectSettings {
  color: string;
  strength: number;
  radius: number;
  falloff: [number, number, number];
  thickness: number;
  depthFalloff: number;
  normalThreshold: number;
  quality: 'low' | 'medium' | 'high';
  resolutionScale: number;
  temporalFiltering: boolean;
  temporalMaxFrames: number;
  temporalClamp: number;
  temporalFlickerSuppression: number;
}

export const DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS: Readonly<ScreenSpaceSssRenderSettings> = {
  enabled: false,
  color: '#ffb59e',
  strength: 1.15,
  radius: 18,
  falloff: [1, 0.72, 0.5],
  thickness: 0.78,
  depthFalloff: 36,
  normalThreshold: 0.05,
  quality: 'low',
  resolutionScale: 0.5,
  temporalFiltering: true,
  temporalMaxFrames: 16,
  temporalClamp: 1,
  temporalFlickerSuppression: 1,
};

export const SCREEN_SPACE_SSS_PARAMETERS: readonly RenderParameterDefinition[] = [
  number('resolutionScale', 'Sample resolution', 0.25, 1, 0.05),
  toggle('temporalFiltering', 'Temporal filtering'),
  number('temporalMaxFrames', 'History frames', 1, 64, 1),
  number('temporalClamp', 'History clamp', 0, 4, 0.05),
  number('temporalFlickerSuppression', 'Flicker suppression', 0, 4, 0.05),
  number('strength', 'Strength', 0, 1.5, 0.01),
  number('radius', 'Radius', 0.25, 32, 0.25),
  number('thickness', 'Thickness', 0.01, 1, 0.01),
  number('depthFalloff', 'Depth edge stop', 1, 256, 1),
  number('normalThreshold', 'Normal edge stop', -1, 0.99, 0.01),
  number('falloff.0', 'Falloff R', 0, 2, 0.01),
  number('falloff.1', 'Falloff G', 0, 2, 0.01),
  number('falloff.2', 'Falloff B', 0, 2, 0.01),
];

export const SCREEN_SPACE_SSS_PRESETS = {
  skin: {
    label: 'Skin',
    color: '#ffb59e',
    strength: 1.15,
    radius: 18,
    falloff: [1, 0.72, 0.5],
    thickness: 0.78,
    depthFalloff: 36,
    normalThreshold: 0.05,
  },
  wax: {
    label: 'Wax',
    color: '#ffd2a1',
    strength: 1.35,
    radius: 24,
    falloff: [1, 0.82, 0.58],
    thickness: 0.92,
    depthFalloff: 28,
    normalThreshold: -0.1,
  },
  jade: {
    label: 'Jade',
    color: '#9fffc5',
    strength: 1.05,
    radius: 20,
    falloff: [0.5, 1, 0.72],
    thickness: 0.85,
    depthFalloff: 42,
    normalThreshold: 0.1,
  },
} as const;

export function resolveScreenSpaceSssRenderSettings(
  input: unknown,
): ScreenSpaceSssRenderSettings {
  const source =
    typeof input === 'object' && input !== null
      ? (input as Partial<ScreenSpaceSssRenderSettings>)
      : {};
  const sourceFalloff = Array.isArray(source.falloff) ? source.falloff : [];
  const fallback = DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS.falloff;
  const falloff: [number, number, number] = [
    Number(sourceFalloff[0] ?? fallback[0]),
    Number(sourceFalloff[1] ?? fallback[1]),
    Number(sourceFalloff[2] ?? fallback[2]),
  ];

  return {
    ...structuredClone(DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS),
    ...structuredClone(source),
    enabled: source.enabled === true,
    color:
      typeof source.color === 'string'
        ? source.color
        : DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS.color,
    quality: ['low', 'medium', 'high'].includes(String(source.quality))
      ? (source.quality as ScreenSpaceSssRenderSettings['quality'])
      : DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS.quality,
    falloff,
  };
}

export function formatRenderControlValue(value: number, step = 1): string {
  if (step < 0.01) return value.toFixed(4);
  if (step < 0.1) return value.toFixed(2);
  if (step < 1) return value.toFixed(2);
  return value.toFixed(0);
}

import type { EffectName, EffectsState, QualityPresetName } from './types';

const disabled = (): EffectsState => ({
  traa: { enabled: false },
  fxaa: { enabled: false },
  smaa: { enabled: false },
  ssaa: { enabled: false, samples: 8 },
  gtao: { enabled: false, resolutionScale: 0.5, samples: 16, radius: 0.5, intensity: 1.2, thickness: 1 },
  ssao: { enabled: false, resolutionScale: 0.5, samples: 16, radius: 0.5, intensity: 1.5 },
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
  sparkle: { enabled: false, intensity: 0.8, threshold: 0.78 },
  gradualBackground: { enabled: true, intensity: 1 },
});

export function createQualityPreset(name: QualityPresetName): EffectsState {
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
    state.sparkle.enabled = true;
    return state;
  }

  state.ssaa.enabled = true;
  state.ssaa.samples = 8;
  state.bloom.enabled = true;
  state.dof.enabled = true;
  state.lut.enabled = true;
  state.lensDistortion.enabled = true;
  state.sharpness.enabled = true;
  state.sparkle.enabled = true;
  return state;
}

const aaEffects: EffectName[] = ['traa', 'fxaa', 'smaa', 'ssaa'];

export function enforceEffectRules(state: EffectsState, changed?: EffectName): EffectsState {
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

  // TemporalReprojectNode and RecurrentDenoiseNode are SSR filters, not
  // independent full-frame post effects. Keep the public switches honest by
  // establishing the required chain automatically.
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

export function mergeEffectSettings(
  state: EffectsState,
  effect: EffectName,
  patch: Partial<EffectsState[EffectName]>,
): EffectsState {
  const next = structuredClone(state);
  next[effect] = { ...next[effect], ...patch };
  return enforceEffectRules(next, effect);
}

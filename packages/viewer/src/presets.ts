import {
  createCanonicalQualityPreset,
  enforceCanonicalEffectRules,
  mergeCanonicalEffectSettings,
} from '@kyxos/scene-contract/render-settings';
import type { EffectName, EffectsState, QualityPresetName } from './types';

export function createQualityPreset(name: QualityPresetName): EffectsState {
  return createCanonicalQualityPreset(name) as EffectsState;
}

export function enforceEffectRules(state: EffectsState, changed?: EffectName): EffectsState {
  return enforceCanonicalEffectRules(state, changed) as EffectsState;
}

export function mergeEffectSettings(
  state: EffectsState,
  effect: EffectName,
  patch: Partial<EffectsState[EffectName]>,
): EffectsState {
  return mergeCanonicalEffectSettings(state, effect, patch) as EffectsState;
}

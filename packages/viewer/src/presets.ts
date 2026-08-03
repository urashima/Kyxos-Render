import {
  createCanonicalQualityPreset,
  enforceCanonicalEffectRules,
  mergeCanonicalEffectSettings,
  type CanonicalEffectState,
} from '@kyxos/scene-contract/render-settings';
import type { SceneEffectSettings } from '@kyxos/scene-contract';
import type { EffectName, EffectsState, QualityPresetName } from './types';

function toCanonical(state: EffectsState): CanonicalEffectState {
  // Viewer effect records intentionally allow internal runtime values while the
  // Scene Contract restricts persisted data to JSON-compatible values. The
  // preset helpers only read/write the shared serializable subset.
  return state as unknown as CanonicalEffectState;
}

export function createQualityPreset(name: QualityPresetName): EffectsState {
  return createCanonicalQualityPreset(name) as unknown as EffectsState;
}

export function enforceEffectRules(state: EffectsState, changed?: EffectName): EffectsState {
  return enforceCanonicalEffectRules(toCanonical(state), changed) as unknown as EffectsState;
}

export function mergeEffectSettings(
  state: EffectsState,
  effect: EffectName,
  patch: Partial<EffectsState[EffectName]>,
): EffectsState {
  return mergeCanonicalEffectSettings(
    toCanonical(state),
    effect,
    patch as unknown as Partial<SceneEffectSettings>,
  ) as unknown as EffectsState;
}

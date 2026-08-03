import type {
  JsonPatchOperation,
  KyxosSceneContract,
  QualityPreset,
  SceneEffectName,
  SceneEffectSettings,
} from '@kyxos/scene-contract';
import {
  RENDER_BACKEND_OPTIONS,
  RENDER_EFFECT_LABELS,
  RENDER_EFFECT_ORDER,
  RENDER_EFFECT_PARAMETERS,
  RENDER_QUALITY_OPTIONS,
  RENDER_TONE_MAPPING_OPTIONS,
  SCREEN_SPACE_SSS_EFFECT,
  SCREEN_SPACE_SSS_PARAMETERS,
  SCREEN_SPACE_SSS_PRESETS,
  createCanonicalQualityPreset,
  formatRenderControlValue,
  mergeCanonicalEffectSettings,
  resolveCanonicalEffects,
  resolveScreenSpaceSssRenderSettings,
  type CanonicalEffectState,
  type RenderOption,
  type RenderParameterDefinition,
  type ScreenSpaceSssRenderSettings,
} from '@kyxos/scene-contract/render-settings';
import { applyKyxosTheme, readStoredTheme, type KyxosTheme } from '@kyxos/ui-theme';
import './render-settings-parity.css';

interface StudioRenderApi {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: JsonPatchOperation[]): void;
}

interface KyxosStudioGlobal {
  api: StudioRenderApi;
}

declare global {
  var kyxosStudio: KyxosStudioGlobal | undefined;
}

const standardEffectNames = new Set<string>(RENDER_EFFECT_ORDER);
const openEffects = new Set<string>();
let mountQueued = false;

function runtime(): KyxosStudioGlobal | null {
  return globalThis.kyxosStudio ?? null;
}

function currentTheme(): KyxosTheme {
  return document.documentElement.dataset.kxTheme === 'graphite' ? 'graphite' : 'moss';
}

function setProductTheme(theme: KyxosTheme): void {
  applyKyxosTheme(theme);
  const shell = document.querySelector<HTMLElement>('.kyxos-studio-shell');
  if (shell) {
    shell.dataset.kxTheme = theme;
    shell.classList.toggle('kx-theme-moss', theme === 'moss');
    shell.classList.toggle('kx-theme-graphite', theme === 'graphite');
  }
  document.querySelectorAll<HTMLElement>('[data-kx-theme-choice]').forEach((button) => {
    const pressed = String(button.dataset.kxThemeChoice === theme);
    if (button.getAttribute('aria-pressed') !== pressed) {
      button.setAttribute('aria-pressed', pressed);
    }
  });
  syncStandaloneThemeToggle();
}

function patch(label: string, operations: JsonPatchOperation[]): void {
  runtime()?.api.applyPatch(label, operations);
}

function replace(path: string, value: unknown): JsonPatchOperation {
  return { op: 'replace', path, value };
}

function mergeSavedStandardEffects(scene: KyxosSceneContract): CanonicalEffectState {
  return resolveCanonicalEffects(scene.renderSettings);
}

function composeEffects(
  scene: KyxosSceneContract,
  standard: CanonicalEffectState,
  sssOverride?: ScreenSpaceSssRenderSettings,
): Record<string, SceneEffectSettings> {
  const saved = scene.renderSettings.effects as Record<string, SceneEffectSettings | undefined>;
  const output: Record<string, SceneEffectSettings> = {};

  for (const [name, settings] of Object.entries(saved)) {
    if (!settings || standardEffectNames.has(name) || name === SCREEN_SPACE_SSS_EFFECT) continue;
    output[name] = structuredClone(settings);
  }
  for (const name of RENDER_EFFECT_ORDER) output[name] = structuredClone(standard[name]);

  const previousSss = saved[SCREEN_SPACE_SSS_EFFECT];
  if (sssOverride || previousSss) {
    output[SCREEN_SPACE_SSS_EFFECT] = structuredClone(
      sssOverride ?? resolveScreenSpaceSssRenderSettings(previousSss),
    );
  }
  return output;
}

function setQuality(scene: KyxosSceneContract, quality: QualityPreset): void {
  const preset = createCanonicalQualityPreset(quality);
  patch('Render quality preset', [
    replace('/renderSettings/qualityPreset', quality),
    replace('/renderSettings/effects', composeEffects(scene, preset)),
  ]);
}

function setEffect(
  scene: KyxosSceneContract,
  effect: SceneEffectName,
  settings: Partial<SceneEffectSettings>,
): void {
  const next = mergeCanonicalEffectSettings(
    mergeSavedStandardEffects(scene),
    effect,
    settings,
  );
  patch(`${RENDER_EFFECT_LABELS[effect]} settings`, [
    replace('/renderSettings/effects', composeEffects(scene, next)),
  ]);
}

function setSss(
  scene: KyxosSceneContract,
  update: Partial<ScreenSpaceSssRenderSettings>,
): void {
  const saved = (scene.renderSettings.effects as Record<string, SceneEffectSettings | undefined>)[
    SCREEN_SPACE_SSS_EFFECT
  ];
  const current = resolveScreenSpaceSssRenderSettings(saved);
  const next = {
    ...current,
    ...structuredClone(update),
    falloff: (update.falloff ? [...update.falloff] : [...current.falloff]) as [number, number, number],
  };
  patch('Screen-space SSS settings', [
    replace(
      '/renderSettings/effects',
      composeEffects(scene, mergeSavedStandardEffects(scene), next),
    ),
  ]);
}

function createSegmented<T extends string>(
  label: string,
  options: readonly RenderOption<T>[],
  selected: T,
  onSelect: (value: T) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row kx-render-row-segmented';
  const caption = document.createElement('span');
  caption.className = 'kx-render-label';
  caption.textContent = label;
  const group = document.createElement('div');
  group.className = 'kx-segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);

  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.dataset.value = option.value;
    button.setAttribute('aria-pressed', String(option.value === selected));
    button.addEventListener('click', () => onSelect(option.value));
    group.append(button);
  }
  row.append(caption, group);
  return row;
}

function createSwitch(
  label: string,
  checked: boolean,
  onToggle: (value: boolean) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kx-render-switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-checked', String(checked));
  button.innerHTML = '<span aria-hidden="true"></span>';
  button.addEventListener('click', () => onToggle(button.getAttribute('aria-checked') !== 'true'));
  return button;
}

function getParameterValue(
  settings: SceneEffectSettings | ScreenSpaceSssRenderSettings,
  key: string,
): unknown {
  if (key.startsWith('falloff.')) {
    return (settings as ScreenSpaceSssRenderSettings).falloff[Number(key.split('.')[1])];
  }
  return settings[key];
}

function updateSssParameter(
  current: ScreenSpaceSssRenderSettings,
  key: string,
  value: number | boolean,
): Partial<ScreenSpaceSssRenderSettings> {
  if (!key.startsWith('falloff.')) {
    return { [key]: value } as Partial<ScreenSpaceSssRenderSettings>;
  }
  const falloff = [...current.falloff] as [number, number, number];
  falloff[Number(key.split('.')[1])] = Number(value);
  return { falloff };
}

function createParameterControl(
  definition: RenderParameterDefinition,
  value: unknown,
  onChange: (value: number | boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row';
  if (definition.description) row.title = definition.description;

  const label = document.createElement('label');
  label.className = 'kx-render-label';
  label.textContent = definition.label;

  if (definition.kind === 'boolean') {
    const control = createSwitch(definition.label, value !== false, onChange);
    row.append(label, control);
    return row;
  }

  const numericValue = Number.isFinite(Number(value))
    ? Number(value)
    : Number(definition.min ?? 0);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(definition.min ?? 0);
  slider.max = String(definition.max ?? 1);
  slider.step = String(definition.step ?? 0.01);
  slider.value = String(numericValue);
  slider.setAttribute('aria-label', definition.label);
  const output = document.createElement('output');
  output.textContent = formatRenderControlValue(numericValue, definition.step);
  slider.addEventListener('input', () => {
    output.textContent = formatRenderControlValue(Number(slider.value), definition.step);
  });
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  row.classList.add('kx-render-row-range');
  row.append(label, slider, output);
  return row;
}

function createEffectCard(
  scene: KyxosSceneContract,
  name: SceneEffectName,
  settings: SceneEffectSettings,
): HTMLDetailsElement {
  const card = document.createElement('details');
  card.className = 'kx-render-effect';
  card.open = openEffects.has(name);
  card.addEventListener('toggle', () => {
    if (card.open) openEffects.add(name);
    else openEffects.delete(name);
  });

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = RENDER_EFFECT_LABELS[name];
  const toggle = createSwitch(`${RENDER_EFFECT_LABELS[name]} enabled`, settings.enabled, (enabled) =>
    setEffect(scene, name, { enabled }),
  );
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  summary.append(title, toggle);
  card.append(summary);

  const body = document.createElement('div');
  body.className = 'kx-render-effect-body';
  const definitions = RENDER_EFFECT_PARAMETERS[name] ?? [];
  if (!definitions.length) {
    const note = document.createElement('p');
    note.className = 'kx-render-empty';
    note.textContent = 'This effect uses the official Three.js defaults.';
    body.append(note);
  }
  for (const definition of definitions) {
    body.append(
      createParameterControl(definition, settings[definition.key], (value) =>
        setEffect(scene, name, { [definition.key]: value }),
      ),
    );
  }
  card.append(body);
  return card;
}

function createSssCard(
  scene: KyxosSceneContract,
  settings: ScreenSpaceSssRenderSettings,
): HTMLDetailsElement {
  const card = document.createElement('details');
  card.className = 'kx-render-effect kx-render-sss';
  card.open = openEffects.has(SCREEN_SPACE_SSS_EFFECT);
  card.addEventListener('toggle', () => {
    if (card.open) openEffects.add(SCREEN_SPACE_SSS_EFFECT);
    else openEffects.delete(SCREEN_SPACE_SSS_EFFECT);
  });

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = 'Screen-Space SSS';
  const toggle = createSwitch('Screen-space SSS enabled', settings.enabled, (enabled) =>
    setSss(scene, { enabled }),
  );
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  summary.append(title, toggle);
  card.append(summary);

  const body = document.createElement('div');
  body.className = 'kx-render-effect-body';
  body.append(
    createSegmented(
      'Samples',
      [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ] as const,
      settings.quality,
      (quality) => setSss(scene, { quality }),
    ),
  );

  const presets = document.createElement('div');
  presets.className = 'kx-render-row kx-render-row-presets';
  const label = document.createElement('span');
  label.className = 'kx-render-label';
  label.textContent = 'Material profile';
  const group = document.createElement('div');
  group.className = 'kx-sss-presets';
  for (const [name, preset] of Object.entries(SCREEN_SPACE_SSS_PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.style.setProperty('--kx-sss-swatch', preset.color);
    button.dataset.preset = name;
    button.addEventListener('click', () =>
      setSss(scene, {
        enabled: true,
        color: preset.color,
        strength: preset.strength,
        radius: preset.radius,
        falloff: [...preset.falloff] as [number, number, number],
        thickness: preset.thickness,
        depthFalloff: preset.depthFalloff,
        normalThreshold: preset.normalThreshold,
      }),
    );
    group.append(button);
  }
  presets.append(label, group);
  body.append(presets);

  for (const definition of SCREEN_SPACE_SSS_PARAMETERS) {
    body.append(
      createParameterControl(
        definition,
        getParameterValue(settings, definition.key),
        (value) => setSss(scene, updateSssParameter(settings, definition.key, value)),
      ),
    );
  }
  card.append(body);
  return card;
}

function buildRenderPanel(section: HTMLDetailsElement, scene: KyxosSceneContract): void {
  const summary = section.querySelector(':scope > summary');
  if (!summary) return;
  section.dataset.renderSettingsParity = 'playground';
  section.classList.add('kx-render-settings');
  section.open = true;
  while (summary.nextSibling) summary.nextSibling.remove();

  const body = document.createElement('div');
  body.className = 'kx-render-settings-body';

  const appearance = document.createElement('section');
  appearance.className = 'kx-render-group';
  appearance.innerHTML = '<h3>Appearance</h3>';
  const themeOptions: readonly RenderOption<KyxosTheme>[] = [
    { value: 'moss', label: 'Dark · Green / Black' },
    { value: 'graphite', label: 'Light · Red / White' },
  ];
  const themeControl = createSegmented('Theme', themeOptions, currentTheme(), setProductTheme);
  themeControl.querySelectorAll<HTMLElement>('button').forEach((button) => {
    button.dataset.kxThemeChoice = button.dataset.value;
  });
  appearance.append(themeControl);

  const pipeline = document.createElement('section');
  pipeline.className = 'kx-render-group';
  pipeline.innerHTML = '<h3>Renderer</h3>';
  pipeline.append(
    createSegmented(
      'Backend',
      RENDER_BACKEND_OPTIONS,
      scene.renderSettings.backend,
      (backend) => patch('Renderer backend', [replace('/renderSettings/backend', backend)]),
    ),
    createSegmented(
      'Quality',
      RENDER_QUALITY_OPTIONS,
      scene.renderSettings.qualityPreset,
      (quality) => setQuality(scene, quality),
    ),
    createSegmented(
      'Tone mapping',
      RENDER_TONE_MAPPING_OPTIONS,
      scene.renderSettings.toneMapping,
      (toneMapping) =>
        patch('Tone mapping', [replace('/renderSettings/toneMapping', toneMapping)]),
    ),
    createParameterControl(
      { key: 'exposure', label: 'Exposure', kind: 'number', min: 0, max: 8, step: 0.01 },
      scene.renderSettings.exposure,
      (value) => patch('Exposure', [replace('/renderSettings/exposure', value)]),
    ),
  );

  const effects = document.createElement('section');
  effects.className = 'kx-render-group kx-render-effects';
  effects.innerHTML = '<h3>Playground effect stack</h3>';
  const standard = mergeSavedStandardEffects(scene);
  for (const name of RENDER_EFFECT_ORDER) {
    effects.append(createEffectCard(scene, name, standard[name]));
  }

  const rawEffects = scene.renderSettings.effects as Record<string, SceneEffectSettings | undefined>;
  const sss = resolveScreenSpaceSssRenderSettings(rawEffects[SCREEN_SPACE_SSS_EFFECT]);
  effects.append(createSssCard(scene, sss));

  body.append(appearance, pipeline, effects);
  section.append(body);
}

function findRenderSection(): HTMLDetailsElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLDetailsElement>('details.inspector-section')).find(
      (section) =>
        section.querySelector(':scope > summary')?.textContent?.trim() === 'Render Settings',
    ) ?? null
  );
}

function syncStandaloneThemeToggle(): void {
  const shell = document.querySelector('.kyxos-studio-shell');
  let button = document.querySelector<HTMLButtonElement>('#kx-studio-product-theme');
  if (shell) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement('button');
    button.id = 'kx-studio-product-theme';
    button.type = 'button';
    button.className = 'kx-product-theme-toggle';
    button.addEventListener('click', () =>
      setProductTheme(currentTheme() === 'moss' ? 'graphite' : 'moss'),
    );
    document.body.append(button);
  }
  const light = currentTheme() === 'graphite';
  const text = light ? 'Dark theme' : 'Light theme';
  const label = light
    ? 'Use dark green and black theme'
    : 'Use light red and white theme';
  if (button.textContent !== text) button.textContent = text;
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
}

function mount(): void {
  syncStandaloneThemeToggle();
  const api = runtime()?.api;
  const section = findRenderSection();
  if (!api || !section || section.dataset.renderSettingsParity === 'playground') return;
  buildRenderPanel(section, api.getScene());
}

function scheduleMount(): void {
  if (mountQueued) return;
  mountQueued = true;
  queueMicrotask(() => {
    mountQueued = false;
    mount();
  });
}

applyKyxosTheme(readStoredTheme());
const observer = new MutationObserver((mutations) => {
  const structuralChange = mutations.some((mutation) => {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
    return !target?.closest('#kx-studio-product-theme');
  });
  if (structuralChange) scheduleMount();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('kyxos:theme-change', scheduleMount);
scheduleMount();

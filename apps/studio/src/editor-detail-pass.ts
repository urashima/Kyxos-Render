import './editor-detail-pass.css';

type Density = 'comfortable' | 'compact';
type MotionPreference = 'system' | 'reduced' | 'full';

interface EditorDetailPreferences {
  density: Density;
  motion: MotionPreference;
  hierarchyWidth: number;
  inspectorWidth: number;
  assetsHeight: number;
  touchTarget: number;
  thumbnailSize: number;
  panelBlur: boolean;
  mobileDock: boolean;
}

const PREFERENCES_KEY = 'kyxos-studio-editor-detail-preferences-v1';
const WINDOW_KEY_PREFIX = 'kyxos-studio-window-v1:';
const DEFAULT_PREFERENCES: EditorDetailPreferences = {
  density: 'comfortable',
  motion: 'system',
  hierarchyWidth: 248,
  inspectorWidth: 318,
  assetsHeight: 178,
  touchTarget: 48,
  thumbnailSize: 72,
  panelBlur: true,
  mobileDock: true,
};

const replayingButtons = new WeakSet<HTMLButtonElement>();
const enhancedDialogs = new WeakSet<HTMLDialogElement>();
let preferences = readPreferences();
let settingsDialog: HTMLDialogElement | null = null;
let projectMenu: HTMLElement | null = null;

applyPreferences(preferences);
installGlobalInteractions();
scanDocument();

const documentObserver = new MutationObserver(() => scanDocument());
documentObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

function readPreferences(): EditorDetailPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<EditorDetailPreferences>;
    return sanitizePreferences({ ...DEFAULT_PREFERENCES, ...stored });
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function sanitizePreferences(value: EditorDetailPreferences): EditorDetailPreferences {
  return {
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    motion: value.motion === 'reduced' || value.motion === 'full' ? value.motion : 'system',
    hierarchyWidth: clampNumber(value.hierarchyWidth, 208, 420, DEFAULT_PREFERENCES.hierarchyWidth),
    inspectorWidth: clampNumber(value.inspectorWidth, 280, 520, DEFAULT_PREFERENCES.inspectorWidth),
    assetsHeight: clampNumber(value.assetsHeight, 132, 420, DEFAULT_PREFERENCES.assetsHeight),
    touchTarget: clampNumber(value.touchTarget, 40, 58, DEFAULT_PREFERENCES.touchTarget),
    thumbnailSize: clampNumber(value.thumbnailSize, 54, 112, DEFAULT_PREFERENCES.thumbnailSize),
    panelBlur: Boolean(value.panelBlur),
    mobileDock: value.mobileDock !== false,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function savePreferences(next: EditorDetailPreferences): void {
  preferences = sanitizePreferences(next);
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain live for the current session when storage is unavailable.
  }
  applyPreferences(preferences);
}

function applyPreferences(value: EditorDetailPreferences): void {
  const root = document.documentElement;
  root.dataset.kxDensity = value.density;
  root.dataset.kxPanelBlur = value.panelBlur ? 'on' : 'off';
  root.dataset.kxMobileDock = value.mobileDock ? 'on' : 'off';
  root.style.setProperty('--kx-detail-hierarchy-width', `${value.hierarchyWidth}px`);
  root.style.setProperty('--kx-detail-inspector-width', `${value.inspectorWidth}px`);
  root.style.setProperty('--kx-detail-assets-height', `${value.assetsHeight}px`);
  root.style.setProperty('--kx-detail-touch-target', `${value.touchTarget}px`);
  root.style.setProperty('--kx-detail-thumbnail-size', `${value.thumbnailSize}px`);

  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = value.motion === 'reduced' || (value.motion === 'system' && systemReduced);
  root.dataset.kxMotion = reduced ? 'reduced' : 'full';

  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach((shell) => {
    shell.classList.add('kx-detail-ready');
  });
}

function scanDocument(): void {
  document.querySelectorAll<HTMLElement>('.project-card').forEach(enhanceProjectCard);
  document.querySelectorAll<HTMLElement>('.asset-workspace-item').forEach(enhanceAssetCard);
  document.querySelectorAll<HTMLDialogElement>('dialog.release-dialog').forEach(enhanceEditorDialog);
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(enhanceStudioShell);
}

function enhanceStudioShell(shell: HTMLElement): void {
  shell.classList.add('kx-detail-ready');
  if (shell.dataset.detailPassMounted === 'true') return;
  shell.dataset.detailPassMounted = 'true';

  const topbarEnd = shell.querySelector<HTMLElement>('.studio-topbar-end');
  if (topbarEnd) {
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'kx-detail-icon-button';
    settingsButton.setAttribute('aria-label', 'Editor settings');
    settingsButton.title = 'Editor settings · Ctrl / ⌘ ,';
    settingsButton.textContent = '⚙';
    settingsButton.addEventListener('click', openSettings);
    topbarEnd.prepend(settingsButton);
  }

  shell.append(createMobileDock(shell));
  applyPreferences(preferences);
}

function createMobileDock(shell: HTMLElement): HTMLElement {
  const dock = document.createElement('nav');
  dock.className = 'kx-mobile-dock';
  dock.setAttribute('aria-label', 'Mobile editor controls');

  const actions: Array<[string, () => void]> = [
    ['Hierarchy', () => clickByLabel(shell, 'Toggle hierarchy')],
    ['Select', () => clickByText(shell, 'Select')],
    ['Move', () => clickByText(shell, 'Move')],
    ['Rotate', () => clickByText(shell, 'Rotate')],
    ['Assets', () => shell.classList.toggle('kx-mobile-assets-open')],
    ['Inspector', () => clickByLabel(shell, 'Toggle inspector')],
    ['Upload', () => clickByText(shell, 'Upload')],
    ['Publish', () => clickByText(shell, 'Publish')],
    ['Settings', openSettings],
  ];

  for (const [label, action] of actions) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', action);
    dock.append(control);
  }
  return dock;
}

function clickByText(root: ParentNode, text: string): void {
  const control = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim().toLowerCase() === text.toLowerCase(),
  );
  control?.click();
}

function clickByLabel(root: ParentNode, label: string): void {
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
}

function openSettings(): void {
  settingsDialog ??= createSettingsDialog();
  syncSettingsForm(settingsDialog, preferences);
  if (!settingsDialog.open) settingsDialog.showModal();
}

function createSettingsDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'kx-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'kx-settings-title');
  dialog.innerHTML = `
    <header class="dialog-header kx-settings-header">
      <div>
        <span class="kx-settings-eyebrow">Kyxos Studio</span>
        <h2 id="kx-settings-title">Editor Preferences</h2>
      </div>
      <button type="button" class="secondary" data-settings-close>Close</button>
    </header>
    <form method="dialog" class="kx-settings-form">
      <section class="kx-settings-section">
        <div class="kx-settings-section-copy">
          <h3>Layout</h3>
          <p>Panel dimensions are applied immediately and persist for this browser.</p>
        </div>
        <label class="kx-setting-row">
          <span><strong>Density</strong><small>Comfortable or compact authoring controls.</small></span>
          <select name="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
        </label>
        ${rangeRow('hierarchyWidth', 'Hierarchy width', 'Width of the left entity tree.', 208, 420, 4, 'px')}
        ${rangeRow('inspectorWidth', 'Inspector width', 'Space reserved for schema-generated fields.', 280, 520, 4, 'px')}
        ${rangeRow('assetsHeight', 'Asset shelf height', 'Height of assets, animations, presets and console.', 132, 420, 4, 'px')}
        ${rangeRow('thumbnailSize', 'Asset thumbnail size', 'Grid thumbnail footprint and generated fallback resolution.', 54, 112, 2, 'px')}
      </section>
      <section class="kx-settings-section">
        <div class="kx-settings-section-copy">
          <h3>Input & accessibility</h3>
          <p>Touch targets respect safe areas on phones and tablets.</p>
        </div>
        ${rangeRow('touchTarget', 'Touch target', 'Minimum mobile and coarse-pointer control size.', 40, 58, 2, 'px')}
        <label class="kx-setting-row">
          <span><strong>Motion</strong><small>Follow the OS preference or override editor animation.</small></span>
          <select name="motion"><option value="system">Follow system</option><option value="reduced">Reduced</option><option value="full">Full</option></select>
        </label>
        ${checkRow('mobileDock', 'Mobile command dock', 'Keep core authoring actions reachable above the device safe area.')}
        ${checkRow('panelBlur', 'Panel backdrop blur', 'Disable blur on low-power devices or remote sessions.')}
      </section>
      <section class="kx-settings-section kx-settings-help">
        <div class="kx-settings-section-copy">
          <h3>Editor workflow</h3>
          <p>Hierarchy, Inspector, Assets, State Graph, version control and source files continue to use the same CommandBus and persistence path.</p>
        </div>
        <div class="kx-shortcut-list">
          <span>Command palette</span><kbd>Ctrl / ⌘ K</kbd>
          <span>Editor settings</span><kbd>Ctrl / ⌘ ,</kbd>
          <span>Transform tools</span><kbd>W / E / R</kbd>
          <span>Frame selection</span><kbd>F</kbd>
          <span>Undo / Redo</span><kbd>Ctrl / ⌘ Z · Y</kbd>
        </div>
      </section>
      <footer class="kx-settings-footer">
        <button type="button" class="secondary" data-settings-reset>Restore defaults</button>
        <span>Preferences are local; project render settings remain versioned with the scene.</span>
        <button type="submit" class="primary">Done</button>
      </footer>
    </form>`;

  document.body.append(dialog);
  dialog.querySelector<HTMLButtonElement>('[data-settings-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector<HTMLButtonElement>('[data-settings-reset]')?.addEventListener('click', () => {
    savePreferences({ ...DEFAULT_PREFERENCES });
    syncSettingsForm(dialog, preferences);
  });

  const form = dialog.querySelector<HTMLFormElement>('form')!;
  form.addEventListener('input', () => {
    savePreferences(readSettingsForm(form));
    syncRangeOutputs(form);
  });
  form.addEventListener('change', () => {
    savePreferences(readSettingsForm(form));
    syncRangeOutputs(form);
  });
  return dialog;
}

function rangeRow(
  name: keyof EditorDetailPreferences,
  label: string,
  hint: string,
  min: number,
  max: number,
  step: number,
  unit: string,
): string {
  return `<label class="kx-setting-row kx-setting-range">
    <span><strong>${label}</strong><small>${hint}</small></span>
    <span class="kx-range-control"><input name="${name}" type="range" min="${min}" max="${max}" step="${step}"><output data-output-for="${name}" data-unit="${unit}"></output></span>
  </label>`;
}

function checkRow(name: keyof EditorDetailPreferences, label: string, hint: string): string {
  return `<label class="kx-setting-row">
    <span><strong>${label}</strong><small>${hint}</small></span>
    <input name="${name}" type="checkbox" role="switch">
  </label>`;
}

function syncSettingsForm(dialog: HTMLDialogElement, value: EditorDetailPreferences): void {
  const form = dialog.querySelector<HTMLFormElement>('form');
  if (!form) return;
  setFormValue(form, 'density', value.density);
  setFormValue(form, 'motion', value.motion);
  setFormValue(form, 'hierarchyWidth', value.hierarchyWidth);
  setFormValue(form, 'inspectorWidth', value.inspectorWidth);
  setFormValue(form, 'assetsHeight', value.assetsHeight);
  setFormValue(form, 'touchTarget', value.touchTarget);
  setFormValue(form, 'thumbnailSize', value.thumbnailSize);
  setFormValue(form, 'panelBlur', value.panelBlur);
  setFormValue(form, 'mobileDock', value.mobileDock);
  syncRangeOutputs(form);
}

function setFormValue(form: HTMLFormElement, name: string, value: string | number | boolean): void {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
  else if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = String(value);
}

function readSettingsForm(form: HTMLFormElement): EditorDetailPreferences {
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
  return sanitizePreferences({
    density: select('density').value as Density,
    motion: select('motion').value as MotionPreference,
    hierarchyWidth: Number(input('hierarchyWidth').value),
    inspectorWidth: Number(input('inspectorWidth').value),
    assetsHeight: Number(input('assetsHeight').value),
    touchTarget: Number(input('touchTarget').value),
    thumbnailSize: Number(input('thumbnailSize').value),
    panelBlur: input('panelBlur').checked,
    mobileDock: input('mobileDock').checked,
  });
}

function syncRangeOutputs(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLOutputElement>('output[data-output-for]').forEach((output) => {
    const name = output.dataset.outputFor;
    const input = name ? form.elements.namedItem(name) : null;
    if (input instanceof HTMLInputElement) output.value = `${input.value}${output.dataset.unit ?? ''}`;
  });
}

function enhanceProjectCard(card: HTMLElement): void {
  if (card.dataset.detailThumbnail === 'true') return;
  const thumb = card.querySelector<HTMLElement>('.project-thumb');
  const name = card.querySelector<HTMLElement>('.project-copy h2')?.textContent?.trim() ?? 'Kyxos Project';
  if (thumb && !thumb.querySelector('img,canvas,video')) {
    thumb.replaceChildren(createGeneratedThumbnail(name, 640, 360, 'project'));
    thumb.setAttribute('aria-label', `Generated preview for ${name}`);
  }
  card.dataset.detailThumbnail = 'true';
}

function enhanceAssetCard(card: HTMLElement): void {
  if (card.dataset.detailThumbnail === 'true') return;
  const thumb = card.querySelector<HTMLElement>('.asset-thumbnail');
  const name = card.querySelector<HTMLElement>('.asset-item-copy strong')?.textContent?.trim() ?? 'Asset';
  if (thumb && !thumb.querySelector('img,canvas,video')) {
    thumb.replaceChildren(createGeneratedThumbnail(name, 160, 160, 'asset'));
    thumb.classList.add('kx-generated-thumbnail');
    thumb.setAttribute('aria-label', `Generated fallback preview for ${name}`);
  }
  card.dataset.detailThumbnail = 'true';
}

function createGeneratedThumbnail(
  label: string,
  width: number,
  height: number,
  kind: 'project' | 'asset',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = `kx-thumbnail-canvas ${kind}`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label} preview`);

  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const seed = hashString(label);
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--kx-accent').trim() || '#d7ff5b';
  const surface = style.getPropertyValue('--kx-surface-0').trim() || '#161a16';
  const canvasBackground = style.getPropertyValue('--kx-canvas-bg').trim() || '#282d27';

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, canvasBackground);
  gradient.addColorStop(1, surface);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.14;
  context.strokeStyle = accent;
  context.lineWidth = Math.max(1, width / 420);
  const grid = Math.max(18, Math.round(width / 12));
  for (let x = -height; x < width + height; x += grid) {
    context.beginPath();
    context.moveTo(x, height);
    context.lineTo(x + height, 0);
    context.stroke();
  }

  context.globalAlpha = 0.88;
  context.strokeStyle = accent;
  context.lineWidth = Math.max(2, width / 180);
  const centerX = width * (0.48 + ((seed % 11) - 5) / 100);
  const centerY = height * 0.5;
  const radius = Math.min(width, height) * (kind === 'project' ? 0.25 : 0.31);
  drawWireObject(context, centerX, centerY, radius, seed);

  context.globalAlpha = 0.65;
  context.fillStyle = accent;
  context.font = `600 ${Math.max(9, Math.round(width / 34))}px ui-monospace, monospace`;
  context.fillText(label.slice(0, kind === 'project' ? 28 : 12), width * 0.055, height * 0.9);
  context.globalAlpha = 1;
  return canvas;
}

function drawWireObject(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seed: number,
): void {
  const sides = 5 + (seed % 4);
  context.beginPath();
  for (let index = 0; index <= sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
    const wobble = 0.78 + (((seed >> (index % 16)) & 3) / 12);
    const pointX = x + Math.cos(angle) * radius * wobble;
    const pointY = y + Math.sin(angle) * radius * wobble;
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.stroke();

  context.globalAlpha *= 0.55;
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    context.stroke();
  }
  context.globalAlpha /= 0.55;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function enhanceEditorDialog(dialog: HTMLDialogElement): void {
  const header = dialog.querySelector<HTMLElement>('.dialog-header');
  if (!header || enhancedDialogs.has(dialog)) return;
  enhancedDialogs.add(dialog);
  dialog.classList.add('kx-detail-window');
  header.classList.add('kx-window-drag-handle');

  const controls = document.createElement('div');
  controls.className = 'kx-window-controls';
  const maximize = document.createElement('button');
  maximize.type = 'button';
  maximize.className = 'secondary';
  maximize.setAttribute('aria-label', 'Maximize editor window');
  maximize.textContent = 'Maximize';
  maximize.addEventListener('click', () => {
    const active = dialog.classList.toggle('kx-window-maximized');
    maximize.textContent = active ? 'Restore' : 'Maximize';
    maximize.setAttribute('aria-label', active ? 'Restore editor window' : 'Maximize editor window');
    if (!active) restoreWindowGeometry(dialog);
  });
  controls.append(maximize);
  header.append(controls);

  header.addEventListener('pointerdown', (event) => beginWindowDrag(event, dialog));
  dialog.addEventListener('pointerup', () => persistWindowGeometry(dialog));
  dialog.addEventListener('close', () => persistWindowGeometry(dialog));

  const openObserver = new MutationObserver(() => {
    if (dialog.open && !dialog.classList.contains('kx-window-maximized')) restoreWindowGeometry(dialog);
  });
  openObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  if (dialog.open) restoreWindowGeometry(dialog);
}

function beginWindowDrag(event: PointerEvent, dialog: HTMLDialogElement): void {
  if (event.button !== 0 || matchMedia('(max-width: 900px)').matches) return;
  const target = event.target as HTMLElement;
  if (target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
  if (dialog.classList.contains('kx-window-maximized')) return;

  const rect = dialog.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  dialog.style.position = 'fixed';
  dialog.style.margin = '0';
  dialog.style.left = `${rect.left}px`;
  dialog.style.top = `${rect.top}px`;
  dialog.style.width = `${rect.width}px`;
  dialog.style.height = `${rect.height}px`;
  dialog.classList.add('kx-window-dragging');
  target.setPointerCapture?.(event.pointerId);

  const onMove = (move: PointerEvent) => {
    const nextLeft = Math.min(window.innerWidth - 160, Math.max(0, rect.left + move.clientX - startX));
    const nextTop = Math.min(window.innerHeight - 72, Math.max(0, rect.top + move.clientY - startY));
    dialog.style.left = `${nextLeft}px`;
    dialog.style.top = `${nextTop}px`;
  };
  const onEnd = () => {
    dialog.classList.remove('kx-window-dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    persistWindowGeometry(dialog);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd, { once: true });
}

interface WindowGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

function windowStorageKey(dialog: HTMLDialogElement): string {
  const kind = dialog.classList.contains('code-editor-dialog')
    ? 'code'
    : dialog.classList.contains('animation-graph-dialog')
      ? 'animation-graph'
      : dialog.classList.contains('advanced-tools-dialog')
        ? 'advanced-tools'
        : 'release';
  return `${WINDOW_KEY_PREFIX}${kind}`;
}

function persistWindowGeometry(dialog: HTMLDialogElement): void {
  if (dialog.classList.contains('kx-window-maximized') || matchMedia('(max-width: 900px)').matches) return;
  const rect = dialog.getBoundingClientRect();
  if (rect.width < 280 || rect.height < 160) return;
  const geometry: WindowGeometry = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  try {
    localStorage.setItem(windowStorageKey(dialog), JSON.stringify(geometry));
  } catch {
    // Window geometry persistence is best effort.
  }
}

function restoreWindowGeometry(dialog: HTMLDialogElement): void {
  if (matchMedia('(max-width: 900px)').matches) {
    clearWindowGeometryStyles(dialog);
    return;
  }
  try {
    const geometry = JSON.parse(localStorage.getItem(windowStorageKey(dialog)) ?? 'null') as WindowGeometry | null;
    if (!geometry) return;
    const width = Math.min(window.innerWidth - 24, Math.max(360, geometry.width));
    const height = Math.min(window.innerHeight - 24, Math.max(220, geometry.height));
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, geometry.left));
    const top = Math.min(window.innerHeight - height - 8, Math.max(8, geometry.top));
    dialog.style.position = 'fixed';
    dialog.style.margin = '0';
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
    dialog.style.width = `${width}px`;
    dialog.style.height = `${height}px`;
  } catch {
    clearWindowGeometryStyles(dialog);
  }
}

function clearWindowGeometryStyles(dialog: HTMLDialogElement): void {
  for (const property of ['position', 'margin', 'left', 'top', 'width', 'height']) {
    dialog.style.removeProperty(property);
  }
}

function installGlobalInteractions(): void {
  document.addEventListener('click', handleCapturedClick, true);
  document.addEventListener('pointerdown', (event) => {
    if (projectMenu && !projectMenu.contains(event.target as Node)) closeProjectMenu();
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      openSettings();
    }
    if (event.key === 'Escape') closeProjectMenu();
  });
}

function handleCapturedClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button || replayingButtons.has(button)) {
    if (button) replayingButtons.delete(button);
    return;
  }

  const projectCard = button.closest<HTMLElement>('.project-card');
  if (projectCard && button.classList.contains('icon-button')) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openProjectMenu(button, projectCard);
    return;
  }

  if (button.textContent?.trim() === 'New' && button.closest('.code-editor-dialog')) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void requestText('New source file', 'Project-relative path', 'scripts/main.ts').then((path) => {
      if (path) replayWithPrompt(button, [path]);
    });
  }
}

function openProjectMenu(anchor: HTMLButtonElement, card: HTMLElement): void {
  projectMenu ??= createProjectMenu();
  projectMenu.replaceChildren();
  const name = card.querySelector<HTMLElement>('.project-copy h2')?.textContent?.trim() ?? 'Untitled Project';
  const actions: Array<[string, () => void]> = [
    ['Rename', () => void requestText('Rename project', 'Project name', name).then((next) => {
      if (next) replayWithPrompt(anchor, ['rename', next]);
    })],
    ['Duplicate', () => replayWithPrompt(anchor, ['duplicate'])],
    ['Archive', () => void requestConfirmation('Archive project?', `${name} will be removed from the active project list.`).then((confirmed) => {
      if (confirmed) replayWithPrompt(anchor, ['archive']);
    })],
    ['Delete', () => void requestConfirmation('Delete project?', `Delete ${name}? This action uses the existing project deletion path.`).then((confirmed) => {
      if (confirmed) replayWithPrompt(anchor, ['delete']);
    })],
  ];
  for (const [label, action] of actions) {
    const control = document.createElement('button');
    control.type = 'button';
    control.setAttribute('role', 'menuitem');
    control.textContent = label;
    if (label === 'Delete') control.classList.add('danger');
    control.addEventListener('click', () => {
      closeProjectMenu();
      action();
    });
    projectMenu.append(control);
  }

  const rect = anchor.getBoundingClientRect();
  projectMenu.hidden = false;
  projectMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - 196, rect.right - 188))}px`;
  projectMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - 184, rect.bottom + 6))}px`;
  projectMenu.querySelector<HTMLButtonElement>('button')?.focus();
}

function createProjectMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'kx-project-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  return menu;
}

function closeProjectMenu(): void {
  if (projectMenu) projectMenu.hidden = true;
}

function replayWithPrompt(button: HTMLButtonElement, answers: string[]): void {
  const originalPrompt = window.prompt;
  let index = 0;
  window.prompt = () => answers[index++] ?? null;
  replayingButtons.add(button);
  try {
    button.click();
  } finally {
    window.prompt = originalPrompt;
  }
}

function requestText(title: string, label: string, initialValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'kx-input-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <header><h2></h2><button type="button" class="secondary" data-cancel>Close</button></header>
        <label><span></span><input name="value" autocomplete="off" required></label>
        <footer><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary">Confirm</button></footer>
      </form>`;
    dialog.querySelector('h2')!.textContent = title;
    dialog.querySelector('label span')!.textContent = label;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    input.value = initialValue;
    document.body.append(dialog);

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
      dialog.remove();
    };
    dialog.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((control) => {
      control.addEventListener('click', () => finish(null));
    });
    dialog.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (value) finish(value);
      else input.focus();
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function requestConfirmation(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'kx-input-dialog kx-confirm-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    const header = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = title;
    header.append(heading);
    const copy = document.createElement('p');
    copy.textContent = message;
    const footer = document.createElement('footer');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.className = 'danger';
    confirm.textContent = 'Confirm';
    footer.append(cancel, confirm);
    form.append(header, copy, footer);
    dialog.append(form);
    document.body.append(dialog);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
      dialog.remove();
    };
    cancel.addEventListener('click', () => finish(false));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(true);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.showModal();
    cancel.focus();
  });
}

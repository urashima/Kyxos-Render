import '@kyxos/ui-theme/styles.css';
import '@kyxos/ui-components/styles.css';
import './ui-lab.css';
import {
  createKxAssetCard,
  createKxBadge,
  createKxButton,
  createKxColorInput,
  createKxCommandPalette,
  createKxDialog,
  createKxEmptyState,
  createKxErrorState,
  createKxIconButton,
  createKxNumberInput,
  createKxPresetCard,
  createKxProgress,
  createKxPropertyRow,
  createKxSearchInput,
  createKxSection,
  createKxSelect,
  createKxSlider,
  createKxStatusPill,
  createKxTabs,
  createKxTextInput,
  createKxToastHost,
  createKxToggle,
  setKxState,
  showKxToast,
} from '@kyxos/ui-components';
import { createKxIcon } from '@kyxos/ui-icons';
import { applyKyxosTheme, readStoredTheme, type KyxosTheme } from '@kyxos/ui-theme';

const app = document.querySelector<HTMLElement>('#app')!;
applyKyxosTheme(readStoredTheme());

const shell = document.createElement('main');
shell.className = 'ui-lab-shell';
const header = document.createElement('header');
header.className = 'ui-lab-header';
const brand = document.createElement('div');
brand.className = 'ui-lab-brand';
brand.append(createKxIcon('brand'), Object.assign(document.createElement('div'), { innerHTML: '<strong>Kyxos UI Lab</strong><span>Design system · components · states</span>' }));
const headerActions = document.createElement('div');
headerActions.className = 'ui-lab-actions';
const themeSelect = createKxSelect([{ label: 'Kyxos Moss', value: 'moss' }, { label: 'Kyxos Graphite', value: 'graphite' }], readStoredTheme());
themeSelect.setAttribute('aria-label', 'Theme');
themeSelect.addEventListener('change', () => applyKyxosTheme(themeSelect.value as KyxosTheme));
headerActions.append(themeSelect, createKxButton('Back to Studio', { icon: 'authoring', variant: 'ghost', onClick: () => { location.href = '../'; } }));
header.append(brand, headerActions);

const navigation = createKxTabs([
  { id: 'foundations', label: 'Foundations' },
  { id: 'controls', label: 'Controls' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'assets', label: 'Assets' },
  { id: 'states', label: 'States' },
], 'foundations', (id) => document.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' }));
navigation.classList.add('ui-lab-nav');

const content = document.createElement('div');
content.className = 'ui-lab-content';

function labSection(id: string, title: string, description: string): HTMLElement {
  const section = document.createElement('section');
  section.id = id;
  section.className = 'ui-lab-section';
  const copy = document.createElement('div');
  copy.className = 'ui-lab-section-copy';
  copy.innerHTML = `<h2>${title}</h2><p>${description}</p>`;
  const canvas = document.createElement('div');
  canvas.className = 'ui-lab-canvas';
  section.append(copy, canvas);
  content.append(section);
  return canvas;
}

const foundations = labSection('foundations', 'Foundations', 'Shared tokens keep both themes visually coherent without per-page colors, radii or shadows.');
const swatches = document.createElement('div');
swatches.className = 'token-grid';
for (const [name, token] of [
  ['Accent', '--kx-accent'], ['Surface 0', '--kx-surface-0'], ['Surface 1', '--kx-surface-1'], ['Surface 2', '--kx-surface-2'],
  ['Success', '--kx-success'], ['Warning', '--kx-warning'], ['Danger', '--kx-danger'], ['Info', '--kx-info'],
]) {
  const swatch = document.createElement('div');
  swatch.className = 'token-swatch';
  swatch.style.setProperty('--swatch', `var(${token})`);
  swatch.innerHTML = `<span></span><strong>${name}</strong><code>${token}</code>`;
  swatches.append(swatch);
}
foundations.append(swatches);

const controls = labSection('controls', 'Controls', 'Every control exposes hover, focus, disabled, loading, error and selected states.');
const controlGrid = document.createElement('div');
controlGrid.className = 'component-grid';
const defaultButton = createKxButton('Default', { icon: 'save' });
const accentButton = createKxButton('Publish', { icon: 'publish', tone: 'accent', variant: 'solid' });
const loadingButton = createKxButton('Loading', { icon: 'upload', loading: true });
const errorButton = createKxButton('Error', { icon: 'error', tone: 'danger' });
setKxState(errorButton, 'error');
const disabledButton = createKxButton('Disabled', { disabled: true });
controlGrid.append(defaultButton, accentButton, loadingButton, errorButton, disabledButton, createKxIconButton('more', 'More actions', () => undefined));
controls.append(controlGrid);
const inputs = document.createElement('div');
inputs.className = 'input-grid';
inputs.append(
  createKxPropertyRow('Search', createKxSearchInput('Search assets…')),
  createKxPropertyRow('Text', createKxTextInput('Warm Studio')),
  createKxPropertyRow('Number', createKxNumberInput(1.25, .05)),
  createKxPropertyRow('Strength', createKxSlider(0, 5, 1.8, .01)),
  createKxPropertyRow('Quality', createKxSelect([{ label: 'Performance', value: 'performance' }, { label: 'Balanced', value: 'balanced' }, { label: 'High', value: 'high' }, { label: 'Cinematic', value: 'cinematic' }], 'high')),
  createKxPropertyRow('Enabled', createKxToggle(true, 'Enabled')),
  createKxPropertyRow('Surface Color', createKxColorInput('#d7a38b')),
);
controls.append(inputs);

const inspector = labSection('inspector', 'Inspector structure', 'Properties are grouped by task and progressively disclosed as Basic, Advanced and Debug.');
for (const [title, rows, open] of [
  ['Appearance', [['Strength', createKxSlider(0, 5, 2.2)], ['Radius', createKxNumberInput(1.4, .1)], ['Surface Color', createKxColorInput('#d99f86')]], true],
  ['Quality', [['Preset', createKxSelect([{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }], 'medium')], ['Temporal Filtering', createKxToggle(true, 'Temporal Filtering')]], true],
  ['Advanced', [['History Weight', createKxSlider(0, 1, .86)], ['Motion Rejection', createKxSlider(0, 2, .72)]], false],
  ['Debug', [['Raw Buffer', createKxToggle(false, 'Raw Buffer')], ['Rejection Mask', createKxToggle(false, 'Rejection Mask')]], false],
] as const) {
  const group = createKxSection(title, open);
  for (const [label, control] of rows) group.append(createKxPropertyRow(label, control));
  inspector.append(group);
}

const assets = labSection('assets', 'Asset and preset cards', 'Cards support selected, loading, failed and unavailable states with lazy thumbnails in product surfaces.');
const assetStrip = document.createElement('div');
assetStrip.className = 'asset-lab-strip';
const assetCards = [
  createKxAssetCard('Character.glb', '18 meshes · 7 materials'),
  createKxAssetCard('Fabric Weave', 'Material'),
  createKxAssetCard('Studio Softbox', 'Environment'),
  createKxPresetCard('Cinematic', 'High fidelity'),
  createKxPresetCard('Outdoor', 'Natural light'),
];
assetCards[1].setAttribute('aria-selected', 'true');
assetStrip.append(...assetCards);
assets.append(assetStrip);

const states = labSection('states', 'Feedback and recovery', 'Status always uses text or an icon in addition to color.');
const pills = document.createElement('div');
pills.className = 'component-grid';
pills.append(createKxStatusPill('Saved', 'success'), createKxStatusPill('Saving', 'warning'), createKxStatusPill('Offline', 'info'), createKxStatusPill('Conflict', 'danger'), createKxBadge('WebGPU', 'accent'), createKxBadge('Fallback applied', 'warning'));
states.append(pills, createKxProgress(68, 'Upload progress'), createKxEmptyState('No materials yet', 'Drop a compatible texture or material asset here.'), createKxErrorState('Model parsing failed', 'The GLB contains an unsupported buffer view. Review the import report and try again.'));

const toastHost = createKxToastHost();
const dialog = createKxDialog('Publish immutable version');
const dialogBody = dialog.querySelector<HTMLElement>('.kx-dialog-body')!;
dialogBody.innerHTML = '<div class="publish-steps"><span data-state="done">1 · Validate</span><span data-state="done">2 · Create immutable version</span><span data-state="active">3 · Generate thumbnail</span><span>4 · Publish</span><span>5 · Generate public link</span></div>';
dialogBody.append(createKxButton('Publish', { icon: 'publish', tone: 'accent', variant: 'solid', onClick: () => { dialog.close(); showKxToast(toastHost, 'Published version v12.', 'success'); } }));
const feedbackActions = document.createElement('div');
feedbackActions.className = 'component-grid';
feedbackActions.append(createKxButton('Open dialog', { onClick: () => dialog.showModal() }), createKxButton('Show toast', { onClick: () => showKxToast(toastHost, 'Autosave completed.', 'success') }));
states.append(feedbackActions);

const palette = createKxCommandPalette([
  { id: 'focus', label: 'Switch to Focus mode', category: 'Layout', shortcut: 'Ctrl/⌘ K', run: () => showKxToast(toastHost, 'Focus mode command executed.', 'accent') },
  { id: 'publish', label: 'Publish project', category: 'Project', run: () => dialog.showModal() },
  { id: 'theme', label: 'Switch theme', category: 'Appearance', run: () => { const next: KyxosTheme = document.documentElement.dataset.kxTheme === 'graphite' ? 'moss' : 'graphite'; applyKyxosTheme(next); themeSelect.value = next; } },
]);
const paletteButton = createKxButton('Command palette', { icon: 'command', onClick: () => palette.showModal() });
headerActions.prepend(paletteButton);
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    palette.showModal();
  }
});

shell.append(header, navigation, content, dialog, palette, toastHost);
app.replaceChildren(shell);

import { studioSettings } from './editor-experience-bootstrap';

type WorkspacePreferences = {
  viewportMultiSelect: boolean;
  doubleClickFrame: boolean;
  touchFriendly: boolean;
};

const PREFS_KEY = 'kyxos-studio-workspace-preferences-v1';
const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  viewportMultiSelect: true,
  doubleClickFrame: true,
  touchFriendly: true,
};

function readWorkspacePreferences(): WorkspacePreferences {
  try {
    return {
      ...DEFAULT_WORKSPACE_PREFERENCES,
      ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<WorkspacePreferences>),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFERENCES };
  }
}

function writeWorkspacePreferences(value: WorkspacePreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(value));
  } catch {
    // Best effort when storage is restricted.
  }
  window.dispatchEvent(new CustomEvent('kyxos:workspace-preferences-change', { detail: value }));
}

function settingRow(
  title: string,
  description: string,
  control: HTMLElement,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-settings-row';
  const copy = document.createElement('div');
  copy.className = 'kx-settings-copy';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = description;
  copy.append(strong, small);
  row.append(copy, control);
  return row;
}

function section(title: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'kx-settings-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  root.append(heading);
  return root;
}

function switchControl(value: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function selectControl<T extends string>(
  value: T,
  values: Array<{ label: string; value: T }>,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  for (const entry of values) select.append(new Option(entry.label, entry.value));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

function rangeControl(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'grid';
  wrapper.style.gridTemplateColumns = '1fr 44px';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '7px';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const output = document.createElement('output');
  output.textContent = String(value);
  input.addEventListener('input', () => {
    const numeric = Number(input.value);
    output.textContent = String(numeric);
    onInput(numeric);
  });
  wrapper.append(input, output);
  return wrapper;
}

function applyAssetViewMode(root: HTMLElement): void {
  const mode = studioSettings.value.assetViewMode;
  root.querySelectorAll<HTMLElement>('.asset-workspace-items').forEach((items) => {
    items.classList.toggle('grid', mode === 'grid');
    items.classList.toggle('list', mode === 'list');
  });
}

function createSettingsDialog(root: HTMLElement): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'kx-studio-settings-dialog';

  const header = document.createElement('header');
  header.className = 'kx-settings-header';
  const title = document.createElement('h2');
  title.textContent = 'Studio Settings';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close settings');
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);

  const body = document.createElement('div');
  body.className = 'kx-settings-body';

  const render = () => {
    body.replaceChildren();
    const settings = studioSettings.value;
    const workspace = readWorkspacePreferences();

    const interfaceSection = section('Interface');
    interfaceSection.append(
      settingRow(
        'Compact density',
        'Reduce padding while keeping editor controls touchable.',
        switchControl(settings.compactDensity, (value) => studioSettings.update({ compactDensity: value })),
      ),
      settingRow(
        'Show tooltips',
        'Display shortcut and purpose hints on editor controls.',
        switchControl(settings.showTooltips, (value) => studioSettings.update({ showTooltips: value })),
      ),
      settingRow(
        'Reduced motion',
        'Disable non-essential panel and control animation.',
        switchControl(settings.reducedMotion, (value) => studioSettings.update({ reducedMotion: value })),
      ),
      settingRow(
        'Hierarchy row height',
        'Choose denser desktop rows or larger mobile targets.',
        rangeControl(settings.hierarchyRowHeight, 24, 44, 1, (value) => studioSettings.update({ hierarchyRowHeight: value })),
      ),
    );

    const assetSection = section('Assets');
    assetSection.append(
      settingRow(
        'Default asset view',
        'Switch the asset workspace between thumbnail grid and compact list.',
        selectControl(settings.assetViewMode, [
          { label: 'Thumbnail Grid', value: 'grid' },
          { label: 'Compact List', value: 'list' },
        ], (value) => {
          studioSettings.update({ assetViewMode: value });
          applyAssetViewMode(root);
        }),
      ),
    );

    const viewportSection = section('Viewport');
    viewportSection.append(
      settingRow(
        'Modifier multi-select',
        'Shift adds; Ctrl/Cmd toggles picks in the 3D viewport.',
        switchControl(workspace.viewportMultiSelect, (value) => {
          writeWorkspacePreferences({ ...readWorkspacePreferences(), viewportMultiSelect: value });
        }),
      ),
      settingRow(
        'Double-click to frame',
        'Double-click the viewport to frame the current selection.',
        switchControl(workspace.doubleClickFrame, (value) => {
          writeWorkspacePreferences({ ...readWorkspacePreferences(), doubleClickFrame: value });
        }),
      ),
      settingRow(
        'Touch-friendly editor UI',
        'Use larger panel rows and controls on touch-first devices.',
        switchControl(workspace.touchFriendly, (value) => {
          writeWorkspacePreferences({ ...readWorkspacePreferences(), touchFriendly: value });
          root.classList.toggle('kx-touch-friendly', value);
        }),
      ),
    );

    const layoutSection = section('Workspace');
    const resetLayout = document.createElement('button');
    resetLayout.type = 'button';
    resetLayout.textContent = 'Restore default workspace';
    resetLayout.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('kyxos:workspace-reset'));
    });
    layoutSection.append(settingRow(
      'Panel layout',
      'Clear floating positions and return Hierarchy, Inspector and Assets to their default docks.',
      resetLayout,
    ));

    const portabilitySection = section('Portability');
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy settings';
    copy.addEventListener('click', async () => {
      const payload = JSON.stringify({
        studio: studioSettings.value,
        workspace: readWorkspacePreferences(),
      }, null, 2);
      await navigator.clipboard?.writeText(payload);
      copy.textContent = 'Copied';
      window.setTimeout(() => { copy.textContent = 'Copy settings'; }, 900);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset settings';
    reset.addEventListener('click', () => {
      studioSettings.reset();
      writeWorkspacePreferences({ ...DEFAULT_WORKSPACE_PREFERENCES });
      root.classList.toggle('kx-touch-friendly', DEFAULT_WORKSPACE_PREFERENCES.touchFriendly);
      render();
    });
    actions.append(copy, reset);
    portabilitySection.append(settingRow(
      'Editor preferences',
      'Copy portable settings or reset only UI preferences; project scene data is untouched.',
      actions,
    ));

    body.append(interfaceSection, assetSection, viewportSection, layoutSection, portabilitySection);
  };

  studioSettings.addEventListener('change', render);
  window.addEventListener('kyxos:workspace-preferences-change', render);
  dialog.addEventListener('close', () => applyAssetViewMode(root));
  render();

  const footer = document.createElement('footer');
  footer.className = 'kx-settings-footer';
  const hint = document.createElement('small');
  hint.textContent = 'Preferences are stored per browser. Scene settings remain project data.';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'primary';
  done.textContent = 'Done';
  done.addEventListener('click', () => dialog.close());
  footer.append(hint, done);

  dialog.append(header, body, footer);
  return dialog;
}

function mountSettings(root: HTMLElement): void {
  if (root.dataset.kxSettingsUi === 'true') return;
  root.dataset.kxSettingsUi = 'true';
  const topbarEnd = root.querySelector<HTMLElement>('.studio-topbar-end');
  if (!topbarEnd) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kx-studio-settings-button icon-button';
  button.textContent = '⚙';
  button.title = 'Studio Settings';
  button.setAttribute('aria-label', 'Studio Settings');

  const dialog = createSettingsDialog(root);
  button.addEventListener('click', () => dialog.showModal());
  topbarEnd.prepend(button);
  root.append(dialog);

  const applyWorkspace = () => {
    const prefs = readWorkspacePreferences();
    root.classList.toggle('kx-touch-friendly', prefs.touchFriendly);
    applyAssetViewMode(root);
  };
  applyWorkspace();

  const observer = new MutationObserver(applyAssetViewMode.bind(null, root));
  const assets = root.querySelector<HTMLElement>('.studio-assets');
  if (assets) observer.observe(assets, { childList: true, subtree: true });
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(mountSettings);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();

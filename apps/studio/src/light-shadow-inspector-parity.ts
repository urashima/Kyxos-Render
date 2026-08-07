import type { ProjectSession } from '@kyxos/editor-core';
import type { KyxosSceneContract, SceneLight } from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

interface AdapterPrototype {
  bindSession(session: ProjectSession): () => void;
  __kyxosLightShadowInspectorParityInstalled?: boolean;
}

interface SelectedLight {
  index: number;
  light: SceneLight;
}

function selectedLight(session: ProjectSession): SelectedLight | null {
  const selected = session.selection.selected;
  if (selected.length !== 1) return null;
  const scene = session.document.value;
  const node = scene.nodes.find((entry) => entry.id === selected[0]);
  if (!node?.lightId) return null;
  const index = (scene.lights ?? []).findIndex((entry) => entry.id === node.lightId);
  const light = index >= 0 ? scene.lights?.[index] : undefined;
  return light ? { index, light } : null;
}

function replaceShadow(
  session: ProjectSession,
  index: number,
  label: string,
  key: string,
  value: number | boolean,
  mergeKey?: string,
): void {
  session.commands.execute({
    id: `light-shadow-${key}`,
    label,
    mergeKey,
    patch(scene: KyxosSceneContract) {
      const light = scene.lights?.[index];
      if (!light) return [];
      return [{
        op: light.shadow ? 'replace' : 'add',
        path: `/lights/${index}/shadow`,
        value: { ...(light.shadow ?? {}), [key]: value },
      }];
    },
  });
}

function removeLegacyResolutionField(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.kx-component-field').forEach((field) => {
    if (field.closest('.kx-light-shadow-runtime')) return;
    const caption = field.querySelector<HTMLElement>(':scope > span');
    if (caption?.textContent === 'Shadow Map' || caption?.textContent === 'Shadow Resolution') {
      field.remove();
    }
  });
}

function lightComponentPanel(root: HTMLElement): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(':scope > .kx-component-inspector')]
    .find((panel) => panel.querySelector<HTMLElement>(':scope > summary')?.textContent?.startsWith('Light ·'))
    ?? null;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement('div');
  field.className = 'kx-component-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  control.setAttribute('aria-label', label);
  field.append(caption, control);
  return field;
}

function install(session: ProjectSession): () => void {
  let frame = 0;

  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>('.kyxos-studio-shell .inspector-content');
      if (!root) return;
      removeLegacyResolutionField(root);

      const existing = root.querySelector<HTMLElement>('.kx-light-shadow-runtime');
      if (existing?.contains(document.activeElement)) return;
      existing?.remove();

      const selected = selectedLight(session);
      if (!selected?.light.castShadow) return;
      const lightPanel = lightComponentPanel(root);
      if (!lightPanel) return;

      const details = document.createElement('details');
      details.className = 'kx-component-inspector kx-light-shadow-runtime';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Shadow · Runtime';
      const grid = document.createElement('div');
      grid.className = 'kx-component-inspector-grid';

      const resolution = document.createElement('input');
      resolution.type = 'number';
      resolution.min = '256';
      resolution.max = '4096';
      resolution.step = '256';
      resolution.value = String(Number(selected.light.shadow?.mapSize ?? 1024));
      resolution.title = 'Shadow map resolution · 256–4096';
      resolution.addEventListener('input', () => {
        const value = Number(resolution.value);
        if (!Number.isFinite(value)) return;
        const clamped = Math.max(256, Math.min(4096, Math.round(value / 256) * 256));
        replaceShadow(
          session,
          selected.index,
          'Light shadow resolution',
          'mapSize',
          clamped,
          `light:shadow:mapSize:${selected.light.id}`,
        );
      });

      const updateMode = document.createElement('select');
      updateMode.append(new Option('Realtime', 'realtime'), new Option('Once', 'once'));
      updateMode.value = selected.light.shadow?.autoUpdate === false ? 'once' : 'realtime';
      updateMode.addEventListener('change', () => replaceShadow(
        session,
        selected.index,
        'Light shadow update mode',
        'autoUpdate',
        updateMode.value === 'realtime',
      ));

      const intensity = document.createElement('input');
      intensity.type = 'number';
      intensity.min = '0';
      intensity.max = '1';
      intensity.step = '0.01';
      intensity.value = String(Number(selected.light.shadow?.intensity ?? 1));
      intensity.addEventListener('input', () => {
        const value = Number(intensity.value);
        if (!Number.isFinite(value)) return;
        replaceShadow(
          session,
          selected.index,
          'Light shadow intensity',
          'intensity',
          Math.max(0, Math.min(1, value)),
          `light:shadow:intensity:${selected.light.id}`,
        );
      });

      grid.append(
        row('Shadow Resolution', resolution),
        row('Shadow Update', updateMode),
        row('Shadow Intensity', intensity),
      );
      details.append(summary, grid);

      // Match PlayCanvas' component organization: advanced shadow runtime
      // controls belong to the selected Light component itself, not as an
      // unrelated sibling inspector. Keeping it nested also makes keyboard and
      // accessibility traversal follow the Light component's visual hierarchy.
      lightPanel.append(details);
    });
  };

  const onSelection = () => render();
  const onDocument = () => render();
  session.selection.addEventListener('change', onSelection);
  session.document.addEventListener('change', onDocument);
  render();
  requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    session.selection.removeEventListener('change', onSelection);
    session.document.removeEventListener('change', onDocument);
    document.querySelector('.kx-light-shadow-runtime')?.remove();
  };
}

export function installLightShadowInspectorParity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosLightShadowInspectorParityInstalled) return;
  const originalBindSession = prototype.bindSession;
  prototype.bindSession = function bindSessionWithLightShadowParity(session: ProjectSession): () => void {
    const unbind = originalBindSession.call(this, session);
    const dispose = install(session);
    return () => {
      dispose();
      unbind();
    };
  };
  prototype.__kyxosLightShadowInspectorParityInstalled = true;
}

installLightShadowInspectorParity();

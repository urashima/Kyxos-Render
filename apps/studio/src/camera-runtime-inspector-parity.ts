import type { ProjectSession } from '@kyxos/editor-core';
import type { KyxosSceneContract, SceneCamera } from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

type CameraWithFrustum = SceneCamera & { frustumCulling?: boolean };

interface AdapterPrototype {
  bindSession(session: ProjectSession): () => void;
  __kyxosCameraRuntimeInspectorParityInstalled?: boolean;
}

interface SelectedCamera {
  index: number;
  camera: CameraWithFrustum;
}

function selectedCamera(session: ProjectSession): SelectedCamera | null {
  if (session.selection.selected.length !== 1) return null;
  const scene = session.document.value;
  const node = scene.nodes.find((entry) => entry.id === session.selection.selected[0]);
  if (!node?.cameraId) return null;
  const index = scene.cameras.findIndex((entry) => entry.id === node.cameraId);
  return index >= 0
    ? { index, camera: scene.cameras[index] as CameraWithFrustum }
    : null;
}

function install(session: ProjectSession): () => void {
  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>('.kyxos-studio-shell .inspector-content');
      if (!root) return;
      const existing = root.querySelector<HTMLElement>('.kx-camera-runtime');
      if (existing?.contains(document.activeElement)) return;
      existing?.remove();

      const selected = selectedCamera(session);
      if (!selected) return;
      const details = document.createElement('details');
      details.className = 'kx-component-inspector kx-camera-runtime';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Camera · Runtime';
      const grid = document.createElement('div');
      grid.className = 'kx-component-inspector-grid';
      const row = document.createElement('div');
      row.className = 'kx-component-field';
      const caption = document.createElement('span');
      caption.textContent = 'Frustum Culling';
      const control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = selected.camera.frustumCulling !== false;
      control.setAttribute('aria-label', 'Frustum Culling');
      control.addEventListener('change', () => {
        session.commands.execute({
          id: 'camera-frustum-culling',
          label: 'Camera frustum culling',
          patch(scene: KyxosSceneContract) {
            const camera = scene.cameras[selected.index] as CameraWithFrustum | undefined;
            if (!camera) return [];
            return [{
              op: camera.frustumCulling == null ? 'add' : 'replace',
              path: `/cameras/${selected.index}/frustumCulling`,
              value: control.checked,
            }];
          },
        });
      });
      row.append(caption, control);
      grid.append(row);
      details.append(summary, grid);

      const base = root.querySelector('.kx-component-inspector');
      if (base?.nextSibling) root.insertBefore(details, base.nextSibling);
      else root.prepend(details);
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
    document.querySelector('.kx-camera-runtime')?.remove();
  };
}

export function installCameraRuntimeInspectorParity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosCameraRuntimeInspectorParityInstalled) return;
  const originalBindSession = prototype.bindSession;
  prototype.bindSession = function bindSessionWithCameraRuntimeParity(session: ProjectSession): () => void {
    const unbind = originalBindSession.call(this, session);
    const dispose = install(session);
    return () => {
      dispose();
      unbind();
    };
  };
  prototype.__kyxosCameraRuntimeInspectorParityInstalled = true;
}

installCameraRuntimeInspectorParity();

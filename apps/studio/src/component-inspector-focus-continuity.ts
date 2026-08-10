import type { ProjectSession } from '@kyxos/editor-core';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

interface AdapterPrototype {
  bindSession(session: ProjectSession): () => void;
  __kyxosComponentInspectorFocusContinuityInstalled?: boolean;
}

interface FocusSnapshot {
  selectedNodeId: string;
  summary: string;
  ariaLabel: string;
}

const CONTROL_SELECTOR = 'input,select,textarea,button,[contenteditable="true"],[role="slider"]';

function componentSummary(control: HTMLElement): string {
  const details = control.closest<HTMLDetailsElement>('.kx-component-inspector');
  return details?.querySelector<HTMLElement>(':scope > summary')?.textContent?.trim() ?? '';
}

function installFocusContinuity(session: ProjectSession): () => void {
  const inspector = document.querySelector<HTMLElement>('.kyxos-studio-shell .inspector-content');
  if (!inspector) return () => undefined;

  let snapshot: FocusSnapshot | null = null;
  let restoreFrame = 0;

  const capture = (target: HTMLElement) => {
    const selected = session.selection.selected;
    const ariaLabel = target.getAttribute('aria-label')?.trim() ?? '';
    const summary = componentSummary(target);
    if (selected.length !== 1 || !ariaLabel || !summary) {
      snapshot = null;
      return;
    }
    snapshot = {
      selectedNodeId: selected[0],
      summary,
      ariaLabel,
    };
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(CONTROL_SELECTOR)) return;
    if (!target.closest('.kx-component-inspector')) return;
    capture(target);
  };

  const onFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    queueMicrotask(() => {
      // Reactive inspector rebuilds physically detach the focused input. Keep
      // the snapshot in that case so the equivalent control can receive focus
      // again. A normal user blur leaves the old control connected and clears
      // continuity instead.
      if (!target.isConnected) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest('.kx-component-inspector')) {
        snapshot = null;
      }
    });
  };

  const restore = () => {
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      if (!snapshot) return;
      const selected = session.selection.selected;
      if (selected.length !== 1 || selected[0] !== snapshot.selectedNodeId) {
        snapshot = null;
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.kx-component-inspector')) return;

      const sections = [...inspector.querySelectorAll<HTMLDetailsElement>('.kx-component-inspector')];
      const section = sections.find((candidate) =>
        candidate.querySelector<HTMLElement>(':scope > summary')?.textContent?.trim() === snapshot?.summary,
      );
      if (!section) return;
      const control = [...section.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)].find((candidate) =>
        candidate.getAttribute('aria-label')?.trim() === snapshot?.ariaLabel,
      );
      if (!control || control.matches(':disabled')) return;
      control.focus({ preventScroll: true });
      if (control instanceof HTMLInputElement && control.type === 'text') {
        const end = control.value.length;
        control.setSelectionRange(end, end);
      }
    });
  };

  const observer = new MutationObserver((records) => {
    if (!snapshot) return;
    if (records.some((record) => record.type === 'childList')) restore();
  });
  observer.observe(inspector, { childList: true, subtree: true });
  inspector.addEventListener('focusin', onFocusIn, true);
  inspector.addEventListener('focusout', onFocusOut, true);

  const onSelection = () => {
    const selected = session.selection.selected;
    if (!snapshot || selected.length !== 1 || selected[0] !== snapshot.selectedNodeId) snapshot = null;
  };
  session.selection.addEventListener('change', onSelection);

  return () => {
    cancelAnimationFrame(restoreFrame);
    observer.disconnect();
    inspector.removeEventListener('focusin', onFocusIn, true);
    inspector.removeEventListener('focusout', onFocusOut, true);
    session.selection.removeEventListener('change', onSelection);
  };
}

export function installComponentInspectorFocusContinuity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosComponentInspectorFocusContinuityInstalled) return;
  const originalBindSession = prototype.bindSession;
  prototype.bindSession = function bindSessionWithInspectorFocusContinuity(session: ProjectSession): () => void {
    const unbind = originalBindSession.call(this, session);
    const dispose = installFocusContinuity(session);
    return () => {
      dispose();
      unbind();
    };
  };
  prototype.__kyxosComponentInspectorFocusContinuityInstalled = true;
}

installComponentInspectorFocusContinuity();
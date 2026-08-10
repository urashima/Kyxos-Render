import type { ProjectSession } from '@kyxos/editor-core';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const installKey = Symbol.for('kyxos.studio.asset-thumbnail-observer-budget');

type AdapterPrototype = {
  bindSession(session: ProjectSession): () => void;
  [installKey]?: boolean;
};

type MutationCallback = ConstructorParameters<typeof MutationObserver>[0];

/**
 * Asset thumbnail parity observes the full Studio subtree so newly virtualized
 * cards can be decorated. Its callback also changes card DOM (badge text,
 * classes, preview nodes). WebKit delivers MutationObserver callbacks at the
 * microtask checkpoint; a whole-document observer that mutates the same subtree
 * can therefore enqueue itself repeatedly before the import Promise continuation
 * gets to run. The observed symptom was GLB import reaching document-activated
 * and then never returning to build-contract completion on iOS/WebKit.
 *
 * Install a scoped MutationObserver constructor only while the composed
 * bindSession() chain is creating its observers. Whole-document child-list
 * observers are coalesced onto a zero-delay task; narrower observers retain
 * native microtask timing. The global constructor is restored immediately after
 * bindSession returns, so unrelated runtime observers are not changed.
 */
function createBudgetedMutationObserverClass(
  NativeMutationObserver: typeof MutationObserver,
): typeof MutationObserver {
  return class BudgetedMutationObserver implements MutationObserver {
    private readonly native: MutationObserver;
    private deferWholeDocument = false;
    private pendingRecords: MutationRecord[] = [];
    private timer = 0;
    private disconnected = false;

    constructor(callback: MutationCallback) {
      this.native = new NativeMutationObserver((records, observer) => {
        if (!this.deferWholeDocument) {
          callback(records, observer);
          return;
        }

        this.pendingRecords.push(...records);
        if (this.timer || this.disconnected) return;
        this.timer = window.setTimeout(() => {
          this.timer = 0;
          if (this.disconnected) return;
          const batch = this.pendingRecords.splice(0);
          if (!batch.length) return;
          callback(batch, this as unknown as MutationObserver);
        }, 0);
      });
    }

    disconnect(): void {
      this.disconnected = true;
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.pendingRecords.length = 0;
      this.native.disconnect();
    }

    observe(target: Node, options?: MutationObserverInit): void {
      if (
        target === document.documentElement
        && options?.childList === true
        && options?.subtree === true
      ) {
        this.deferWholeDocument = true;
        document.documentElement.dataset.assetThumbnailObserverBudget = 'task-coalesced';
      }
      this.native.observe(target, options);
    }

    takeRecords(): MutationRecord[] {
      const records = [...this.pendingRecords, ...this.native.takeRecords()];
      this.pendingRecords.length = 0;
      return records;
    }
  } as unknown as typeof MutationObserver;
}

const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
if (!prototype[installKey]) {
  const originalBindSession = prototype.bindSession;

  prototype.bindSession = function bindSessionWithThumbnailObserverBudget(
    this: BrowserKyxosViewportAdapter,
    session: ProjectSession,
  ): () => void {
    const NativeMutationObserver = window.MutationObserver;
    const BudgetedMutationObserver = createBudgetedMutationObserverClass(NativeMutationObserver);
    window.MutationObserver = BudgetedMutationObserver;
    globalThis.MutationObserver = BudgetedMutationObserver;
    try {
      return originalBindSession.call(this, session);
    } finally {
      window.MutationObserver = NativeMutationObserver;
      globalThis.MutationObserver = NativeMutationObserver;
    }
  };

  prototype[installKey] = true;
}

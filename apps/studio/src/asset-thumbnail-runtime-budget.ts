import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const installKey = Symbol.for('kyxos.studio.asset-thumbnail-runtime-budget');
const IMPORT_COOLDOWN_MS = 1800;
const MAX_WAIT_MS = 8000;

type AdapterPrototype = {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  [installKey]?: boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function importAgeMs(): number {
  const completedAt = document.documentElement.dataset.importCompletedAt;
  if (!completedAt) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(completedAt);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

async function waitForPrimaryViewportBudget(host: HTMLElement): Promise<void> {
  const startedAt = performance.now();
  host.dataset.thumbnailRuntimeBudget = 'waiting-primary';

  while (performance.now() - startedAt < MAX_WAIT_MS) {
    const html = document.documentElement.dataset;
    const primary = document.querySelector<HTMLCanvasElement>('#studio-canvas');
    const importActive = html.importWorkerBoundary === 'running' && html.importCoreComplete !== 'true';
    const modelLoading = primary?.dataset.studioRuntimeModelLoading === 'true';
    const authoringReady = primary?.dataset.authoringReady === 'true';
    const cooledDown = importAgeMs() >= IMPORT_COOLDOWN_MS;

    if (primary && authoringReady && !importActive && !modelLoading && cooledDown) break;
    await delay(100);
  }

  // Keep the secondary context off the same paint in which the primary Studio
  // viewport becomes renderable. Two successful primary paints make texture/
  // render-target residency much less bursty on desktop WebGL2/WebGPU drivers.
  await twoFrames();
  host.dataset.thumbnailRuntimeBudget = 'primary-stable';
}

const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
if (!prototype[installKey]) {
  const originalMount = prototype.mount;

  prototype.mount = async function mountWithThumbnailRuntimeBudget(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    const host = canvas.closest<HTMLElement>('.kx-thumbnail-render-host');
    if (!host) return originalMount.call(this, canvas);

    // MobileRuntimeSafety deliberately rejects this secondary Viewer. Preserve
    // that fast path instead of waiting only to reject it later.
    if (document.documentElement.dataset.studioRuntimeProfile === 'mobile-safe') {
      return originalMount.call(this, canvas);
    }

    await waitForPrimaryViewportBudget(host);
    if (!canvas.isConnected || !host.isConnected) {
      throw new Error('Asset thumbnail Viewer was cancelled before its idle budget became available.');
    }
    return originalMount.call(this, canvas);
  };

  prototype[installKey] = true;
}

const sparkleRowSelector = '[data-effect-row="sparkle"]';
let observer: MutationObserver | null = null;
let syncQueued = false;

function syncSparkleControls() {
  const effectControls = document.querySelector<HTMLDivElement>('#effect-controls');
  const parameterControls = document.querySelector<HTMLDivElement>('#parameter-controls');
  const parameterTitle = document.querySelector<HTMLSpanElement>('#parameter-title');
  const sparkleRow = effectControls?.querySelector<HTMLElement>(sparkleRowSelector);

  const focusButton = sparkleRow?.querySelector<HTMLButtonElement>('[data-focus-effect="sparkle"]');
  if (focusButton) {
    focusButton.textContent = 'Sparkle · Three.js Anamorphic';
    sparkleRow.title = 'Official Three.js WebGPU anamorphic lensflare built on BloomNode.';
  }

  if (!parameterControls || !parameterTitle || !parameterTitle.textContent?.startsWith('Sparkle')) return;

  parameterTitle.textContent = 'Sparkle · Three.js Anamorphic Lensflare';

  const intensity = parameterControls.querySelector<HTMLInputElement>(
    '[data-effect-parameter="intensity"]',
  );
  if (intensity) {
    intensity.min = '0';
    intensity.max = '10';
    intensity.step = '0.1';
    const output = intensity.nextElementSibling;
    if (output) output.textContent = Number(intensity.value).toFixed(1);
  }

  const threshold = parameterControls.querySelector<HTMLInputElement>(
    '[data-effect-parameter="threshold"]',
  );
  if (threshold) {
    threshold.min = '0';
    threshold.max = '0.9';
    threshold.step = '0.01';
    const output = threshold.nextElementSibling;
    if (output) output.textContent = Number(threshold.value).toFixed(2);
  }
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncSparkleControls();
  });
}

function mount() {
  const app = document.querySelector('#app');
  if (!app) {
    requestAnimationFrame(mount);
    return;
  }

  observer?.disconnect();
  observer = new MutationObserver(scheduleSync);
  observer.observe(app, { childList: true, subtree: true });
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

export {};

const sparkleRowSelector = '[data-effect-row="sparkle"]';
const sparkleLabel = 'Sparkle · Three.js Anamorphic';
const sparkleTitle = 'Sparkle · Three.js Anamorphic Lensflare';
const sparkleDescription = 'Official Three.js WebGPU anamorphic lensflare built on BloomNode.';
let observer: MutationObserver | null = null;
let syncQueued = false;

function setText(element: Element | null | undefined, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setAttribute(element: Element | null | undefined, name: string, value: string) {
  if (element?.getAttribute(name) !== value) element?.setAttribute(name, value);
}

function syncSparkleControls() {
  const effectControls = document.querySelector<HTMLDivElement>('#effect-controls');
  const parameterControls = document.querySelector<HTMLDivElement>('#parameter-controls');
  const parameterTitle = document.querySelector<HTMLSpanElement>('#parameter-title');
  const sparkleRow = effectControls?.querySelector<HTMLElement>(sparkleRowSelector);

  const focusButton = sparkleRow?.querySelector<HTMLButtonElement>('[data-focus-effect="sparkle"]');
  setText(focusButton, sparkleLabel);
  setAttribute(sparkleRow, 'title', sparkleDescription);

  if (!parameterControls || !parameterTitle || !parameterTitle.textContent?.startsWith('Sparkle')) return;

  setText(parameterTitle, sparkleTitle);

  const intensity = parameterControls.querySelector<HTMLInputElement>(
    '[data-effect-parameter="intensity"]',
  );
  if (intensity) {
    setAttribute(intensity, 'min', '0');
    setAttribute(intensity, 'max', '10');
    setAttribute(intensity, 'step', '0.1');
    setText(intensity.nextElementSibling, Number(intensity.value).toFixed(1));
  }

  const threshold = parameterControls.querySelector<HTMLInputElement>(
    '[data-effect-parameter="threshold"]',
  );
  if (threshold) {
    setAttribute(threshold, 'min', '0');
    setAttribute(threshold, 'max', '0.9');
    setAttribute(threshold, 'step', '0.01');
    setText(threshold.nextElementSibling, Number(threshold.value).toFixed(2));
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

const childRowSelector = '[data-ssgi-temporal-filtering-row]';
let observer: MutationObserver | null = null;
let syncQueued = false;

function syncControl() {
  const controls = document.querySelector<HTMLDivElement>('#effect-controls');
  const ssgiRow = controls?.querySelector<HTMLElement>('[data-effect-row="ssgi"]');
  if (!controls || !ssgiRow) return;

  let childRow = controls.querySelector<HTMLDivElement>(childRowSelector);
  if (!childRow) {
    childRow = document.createElement('div');
    childRow.className = 'control-row';
    childRow.dataset.ssgiTemporalFilteringRow = '';
    childRow.style.paddingLeft = '18px';

    const label = document.createElement('label');
    label.htmlFor = 'ssgi-temporal-filtering-switch';
    label.textContent = '↳ Temporal Filtering';

    const input = document.createElement('input');
    input.id = 'ssgi-temporal-filtering-switch';
    input.className = 'switch';
    input.type = 'checkbox';
    input.dataset.ssgiTemporalFiltering = '';
    input.addEventListener('change', () => {
      window.__kyxosTestApi?.setEffect('ssgi', { temporalFiltering: input.checked });
      scheduleSync();
    });

    childRow.append(label, input);
    ssgiRow.insertAdjacentElement('afterend', childRow);
  }

  const input = childRow.querySelector<HTMLInputElement>('[data-ssgi-temporal-filtering]');
  const ssgi = window.__kyxosTestApi?.getEffects()?.ssgi;
  if (!input || !ssgi) return;

  input.checked = ssgi.temporalFiltering !== false;
  input.disabled = !ssgi.enabled;
  childRow.title = ssgi.enabled
    ? 'Stabilizes only the SSGI result. TRAA remains an independent full-frame anti-aliasing option.'
    : 'Enable SSGI to configure its temporal filtering.';
}

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncControl();
  });
}

function mount() {
  const controls = document.querySelector<HTMLDivElement>('#effect-controls');
  if (!controls) {
    requestAnimationFrame(mount);
    return;
  }

  observer?.disconnect();
  observer = new MutationObserver(scheduleSync);
  observer.observe(controls, { childList: true });
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

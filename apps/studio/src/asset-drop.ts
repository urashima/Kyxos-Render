export {};

const ACCEPTED_EXTENSIONS = new Set([
  'glb',
  'hdr',
  'exr',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'ktx2',
]);

const boundCanvases = new WeakSet<HTMLCanvasElement>();

function extension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

function findUploadInput(canvas: HTMLCanvasElement): HTMLInputElement | null {
  const shell = canvas.closest('.kyxos-studio-shell');
  return (
    shell?.querySelector<HTMLInputElement>('input[type="file"][accept*=".glb"]') ??
    document.querySelector<HTMLInputElement>('input[type="file"][accept*=".glb"]')
  );
}

function dispatchFiles(input: HTMLInputElement, files: File[]): void {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function bindCanvas(canvas: HTMLCanvasElement): void {
  if (boundCanvases.has(canvas)) return;
  const viewport = canvas.parentElement;
  if (!viewport) return;
  boundCanvases.add(canvas);

  const emptyState = document.createElement('div');
  emptyState.className = 'kx-empty-scene';
  emptyState.innerHTML = [
    '<strong>Empty scene</strong>',
    '<span>Drop a GLB here, or choose a model to begin authoring.</span>',
    '<button type="button">Choose GLB</button>',
    '<small>HDR, EXR, PNG, JPEG, WebP and KTX2 can also be dropped as assets.</small>',
  ].join('');
  viewport.append(emptyState);

  const syncEmptyState = () => {
    emptyState.hidden = !canvas.hasAttribute('data-empty-scene');
  };
  syncEmptyState();

  const attributeObserver = new MutationObserver(syncEmptyState);
  attributeObserver.observe(canvas, {
    attributes: true,
    attributeFilter: ['data-empty-scene'],
  });

  emptyState.querySelector('button')?.addEventListener('click', () => {
    findUploadInput(canvas)?.click();
  });

  let dragDepth = 0;
  const setDragging = (active: boolean) => {
    viewport.classList.toggle('kx-asset-dragging', active);
  };

  viewport.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    setDragging(true);
  });

  viewport.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  viewport.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDragging(false);
  });

  viewport.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);

    const files = [...event.dataTransfer.files].filter((file) =>
      ACCEPTED_EXTENSIONS.has(extension(file)),
    );
    if (!files.length) {
      const notice = viewport.querySelector<HTMLElement>('.viewport-overlay');
      if (notice) {
        notice.textContent = 'Unsupported asset. Drop GLB, HDR, EXR, PNG, JPEG, WebP or KTX2.';
        notice.classList.add('error-notice');
      }
      return;
    }

    const input = findUploadInput(canvas);
    if (!input) return;

    // The existing Studio import pipeline owns hashing, upload validation,
    // worker parsing, Scene Contract replacement, autosave and viewport reload.
    // Feed one file at a time through that canonical path.
    dispatchFiles(input, [files[0]]);
  });
}

function bindAvailableCanvases(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('#studio-canvas')) {
    bindCanvas(canvas);
  }
}

const observer = new MutationObserver(bindAvailableCanvases);
observer.observe(document.documentElement, { childList: true, subtree: true });
bindAvailableCanvases();

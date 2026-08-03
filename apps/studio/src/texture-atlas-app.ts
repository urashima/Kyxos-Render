import './texture-atlas.css';
import {
  TextureAtlasEditor,
  createTextureAtlasDocument,
  detectTextureAtlasRegions,
  validateTextureAtlas,
  type AtlasRect,
  type TextureAtlasFrame,
} from '@kyxos/editor-core/texture-atlas';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <main class="atlas-app">
    <header class="atlas-topbar">
      <div class="atlas-brand">
        <span class="atlas-brand-mark">K</span>
        <div><strong>Kyxos Texture Atlas</strong><small>PlayCanvas-aligned frame editor</small></div>
      </div>
      <div class="atlas-actions">
        <label class="atlas-button primary">Open image<input id="atlas-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <button id="atlas-import" type="button">Import JSON</button>
        <input id="atlas-json-input" type="file" accept="application/json,.json" hidden>
        <button id="atlas-export" type="button" disabled>Export JSON</button>
        <a class="atlas-button" href="../">Back to Studio</a>
      </div>
    </header>
    <section class="atlas-toolbar" aria-label="Texture atlas tools">
      <button id="atlas-add" type="button" disabled>Add frame</button>
      <button id="atlas-grid" type="button" disabled>Grid slice</button>
      <button id="atlas-detect" type="button" disabled>Auto detect</button>
      <button id="atlas-duplicate" type="button" disabled>Duplicate</button>
      <button id="atlas-delete" type="button" disabled>Delete</button>
      <span class="atlas-divider"></span>
      <button id="atlas-undo" type="button" disabled>Undo</button>
      <button id="atlas-redo" type="button" disabled>Redo</button>
      <label class="atlas-zoom">Zoom <input id="atlas-zoom" type="range" min="25" max="400" value="100" step="25"><output>100%</output></label>
      <span id="atlas-image-info" class="atlas-image-info">No image loaded</span>
    </section>
    <section class="atlas-workspace">
      <aside class="atlas-panel atlas-frame-panel">
        <header><strong>Frames</strong><span id="atlas-frame-count">0</span></header>
        <input id="atlas-search" type="search" placeholder="Search frames" aria-label="Search frames">
        <div id="atlas-frame-list" class="atlas-frame-list" role="listbox" aria-label="Texture atlas frames"></div>
      </aside>
      <div id="atlas-viewport" class="atlas-viewport">
        <div id="atlas-empty" class="atlas-empty">
          <strong>Open a texture to begin</strong>
          <span>PNG, JPEG and WebP are supported. Slice a grid, detect alpha islands, or draw frames manually.</span>
        </div>
        <div id="atlas-canvas-stage" class="atlas-canvas-stage" hidden>
          <canvas id="atlas-canvas" tabindex="0" aria-label="Texture atlas canvas"></canvas>
        </div>
      </div>
      <aside class="atlas-panel atlas-inspector-panel">
        <header><strong>Frame Inspector</strong></header>
        <div id="atlas-inspector" class="atlas-inspector"><p>Select a frame to edit its rectangle, pivot and nine-slice border.</p></div>
        <section class="atlas-validation">
          <header><strong>Validation</strong><span id="atlas-issue-count">0</span></header>
          <div id="atlas-issues"></div>
        </section>
      </aside>
    </section>
    <footer id="atlas-status" class="atlas-status">Ready</footer>
  </main>
`;

const imageInput = document.querySelector<HTMLInputElement>('#atlas-image-input')!;
const jsonInput = document.querySelector<HTMLInputElement>('#atlas-json-input')!;
const importButton = document.querySelector<HTMLButtonElement>('#atlas-import')!;
const exportButton = document.querySelector<HTMLButtonElement>('#atlas-export')!;
const addButton = document.querySelector<HTMLButtonElement>('#atlas-add')!;
const gridButton = document.querySelector<HTMLButtonElement>('#atlas-grid')!;
const detectButton = document.querySelector<HTMLButtonElement>('#atlas-detect')!;
const duplicateButton = document.querySelector<HTMLButtonElement>('#atlas-duplicate')!;
const deleteButton = document.querySelector<HTMLButtonElement>('#atlas-delete')!;
const undoButton = document.querySelector<HTMLButtonElement>('#atlas-undo')!;
const redoButton = document.querySelector<HTMLButtonElement>('#atlas-redo')!;
const zoomInput = document.querySelector<HTMLInputElement>('#atlas-zoom')!;
const zoomOutput = document.querySelector<HTMLOutputElement>('.atlas-zoom output')!;
const imageInfo = document.querySelector<HTMLElement>('#atlas-image-info')!;
const searchInput = document.querySelector<HTMLInputElement>('#atlas-search')!;
const frameList = document.querySelector<HTMLElement>('#atlas-frame-list')!;
const frameCount = document.querySelector<HTMLElement>('#atlas-frame-count')!;
const inspector = document.querySelector<HTMLElement>('#atlas-inspector')!;
const issuesHost = document.querySelector<HTMLElement>('#atlas-issues')!;
const issueCount = document.querySelector<HTMLElement>('#atlas-issue-count')!;
const status = document.querySelector<HTMLElement>('#atlas-status')!;
const empty = document.querySelector<HTMLElement>('#atlas-empty')!;
const stage = document.querySelector<HTMLElement>('#atlas-canvas-stage')!;
const canvas = document.querySelector<HTMLCanvasElement>('#atlas-canvas')!;
const context = canvas.getContext('2d', { alpha: true })!;

let bitmap: ImageBitmap | null = null;
let sourceName = '';
let editor: TextureAtlasEditor | null = null;
let zoom = 1;
let drag: {
  frameId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: AtlasRect;
  preview: AtlasRect;
} | null = null;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function selectedFrame(): TextureAtlasFrame | null {
  if (!editor?.selected.length) return null;
  return editor.value.frames.find((frame) => frame.id === editor!.selected[0]) ?? null;
}

function refresh(): void {
  const enabled = Boolean(editor && bitmap);
  addButton.disabled = !enabled;
  gridButton.disabled = !enabled;
  detectButton.disabled = !enabled;
  exportButton.disabled = !editor;
  duplicateButton.disabled = !editor?.selected.length;
  deleteButton.disabled = !editor?.selected.length;
  undoButton.disabled = !editor?.canUndo;
  redoButton.disabled = !editor?.canRedo;
  renderFrameList();
  renderInspector();
  renderIssues();
  draw();
}

function draw(): void {
  if (!bitmap || !editor) return;
  const atlas = editor.value;
  canvas.width = atlas.imageWidth;
  canvas.height = atlas.imageHeight;
  canvas.style.width = `${atlas.imageWidth * zoom}px`;
  canvas.style.height = `${atlas.imageHeight * zoom}px`;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, atlas.imageWidth, atlas.imageHeight);
  context.save();
  context.lineWidth = Math.max(1 / zoom, 0.5);
  context.font = `${Math.max(10 / zoom, 6)}px ui-monospace, monospace`;
  context.textBaseline = 'top';
  for (const frame of atlas.frames) {
    const rect = drag?.frameId === frame.id ? drag.preview : frame.rect;
    const selected = editor.selected.includes(frame.id);
    context.strokeStyle = selected ? '#d7ff4a' : '#ffffff';
    context.fillStyle = selected ? 'rgba(215,255,74,0.16)' : 'rgba(0,0,0,0.08)';
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeRect(rect.x + 0.5 / zoom, rect.y + 0.5 / zoom, rect.width - 1 / zoom, rect.height - 1 / zoom);
    context.fillStyle = selected ? '#d7ff4a' : '#ffffff';
    context.fillText(frame.name, rect.x + 3 / zoom, rect.y + 3 / zoom);
    if (selected) {
      const handle = 8 / zoom;
      context.fillRect(rect.x + rect.width - handle, rect.y + rect.height - handle, handle, handle);
      const pivotX = rect.x + rect.width * frame.pivot.x;
      const pivotY = rect.y + rect.height * frame.pivot.y;
      context.beginPath();
      context.moveTo(pivotX - 5 / zoom, pivotY);
      context.lineTo(pivotX + 5 / zoom, pivotY);
      context.moveTo(pivotX, pivotY - 5 / zoom);
      context.lineTo(pivotX, pivotY + 5 / zoom);
      context.stroke();
    }
  }
  context.restore();
}

function renderFrameList(): void {
  frameList.replaceChildren();
  if (!editor) {
    frameCount.textContent = '0';
    return;
  }
  const atlas = editor.value;
  const query = searchInput.value.trim().toLocaleLowerCase();
  frameCount.textContent = String(atlas.frames.length);
  const visible = atlas.frames.filter((frame) =>
    !query || frame.name.toLocaleLowerCase().includes(query) || frame.id.includes(query),
  );
  if (!visible.length) {
    const message = atlas.frames.length ? 'No matching frames.' : 'No frames yet.';
    const emptyRow = document.createElement('p');
    emptyRow.className = 'atlas-list-empty';
    emptyRow.textContent = message;
    frameList.append(emptyRow);
    return;
  }
  for (const frame of visible) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'atlas-frame-row';
    row.dataset.frameId = frame.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(editor.selected.includes(frame.id)));
    row.classList.toggle('selected', editor.selected.includes(frame.id));
    const name = document.createElement('strong');
    name.textContent = frame.name;
    const details = document.createElement('span');
    details.textContent = `${frame.rect.x}, ${frame.rect.y} · ${frame.rect.width} × ${frame.rect.height}`;
    row.append(name, details);
    row.addEventListener('click', (event) => {
      editor?.select([frame.id], event.ctrlKey || event.metaKey ? 'toggle' : 'replace');
      refresh();
    });
    frameList.append(row);
  }
}

function numberField(
  label: string,
  value: number,
  onCommit: (value: number) => void,
  options: { min?: number; max?: number; step?: number } = {},
): HTMLLabelElement {
  const host = document.createElement('label');
  host.className = 'atlas-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.step = String(options.step ?? 1);
  if (options.min != null) input.min = String(options.min);
  if (options.max != null) input.max = String(options.max);
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onCommit(next);
    refresh();
  });
  host.append(caption, input);
  return host;
}

function renderInspector(): void {
  inspector.replaceChildren();
  const frame = selectedFrame();
  if (!frame || !editor) {
    const message = document.createElement('p');
    message.textContent = editor?.selected.length && editor.selected.length > 1
      ? `${editor.selected.length} frames selected.`
      : 'Select a frame to edit its rectangle, pivot and nine-slice border.';
    inspector.append(message);
    return;
  }

  const name = document.createElement('label');
  name.className = 'atlas-field atlas-field-wide';
  const nameCaption = document.createElement('span');
  nameCaption.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.value = frame.name;
  nameInput.addEventListener('change', () => {
    editor?.updateFrame(frame.id, { name: nameInput.value }, 'Rename frame');
    refresh();
  });
  name.append(nameCaption, nameInput);

  const rectSection = document.createElement('fieldset');
  rectSection.innerHTML = '<legend>Rectangle</legend>';
  const commitRect = (patch: Partial<AtlasRect>) => {
    editor?.updateFrame(frame.id, { rect: { ...frame.rect, ...patch } }, 'Edit frame rectangle');
  };
  rectSection.append(
    numberField('X', frame.rect.x, (value) => commitRect({ x: value })),
    numberField('Y', frame.rect.y, (value) => commitRect({ y: value })),
    numberField('Width', frame.rect.width, (value) => commitRect({ width: value }), { min: 1 }),
    numberField('Height', frame.rect.height, (value) => commitRect({ height: value }), { min: 1 }),
  );

  const pivotSection = document.createElement('fieldset');
  pivotSection.innerHTML = '<legend>Pivot</legend>';
  pivotSection.append(
    numberField('X', frame.pivot.x, (value) => editor?.updateFrame(frame.id, { pivot: { ...frame.pivot, x: value } }, 'Edit frame pivot'), { min: 0, max: 1, step: 0.01 }),
    numberField('Y', frame.pivot.y, (value) => editor?.updateFrame(frame.id, { pivot: { ...frame.pivot, y: value } }, 'Edit frame pivot'), { min: 0, max: 1, step: 0.01 }),
  );

  const borderSection = document.createElement('fieldset');
  borderSection.innerHTML = '<legend>Nine-slice border</legend>';
  const commitBorder = (patch: Partial<TextureAtlasFrame['border']>) => {
    editor?.updateFrame(frame.id, { border: { ...frame.border, ...patch } }, 'Edit nine-slice border');
  };
  borderSection.append(
    numberField('Left', frame.border.left, (value) => commitBorder({ left: value }), { min: 0 }),
    numberField('Top', frame.border.top, (value) => commitBorder({ top: value }), { min: 0 }),
    numberField('Right', frame.border.right, (value) => commitBorder({ right: value }), { min: 0 }),
    numberField('Bottom', frame.border.bottom, (value) => commitBorder({ bottom: value }), { min: 0 }),
  );

  inspector.append(name, rectSection, pivotSection, borderSection);
}

function renderIssues(): void {
  issuesHost.replaceChildren();
  const issues = editor ? validateTextureAtlas(editor.value) : [];
  issueCount.textContent = String(issues.length);
  if (!issues.length) {
    const success = document.createElement('p');
    success.className = 'atlas-validation-ok';
    success.textContent = editor ? 'Atlas is valid.' : 'Load an image to validate.';
    issuesHost.append(success);
    return;
  }
  for (const issue of issues) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `atlas-issue ${issue.severity}`;
    row.textContent = issue.message;
    row.title = issue.code;
    row.addEventListener('click', () => {
      if (issue.frameId) editor?.select([issue.frameId]);
      refresh();
    });
    issuesHost.append(row);
  }
}

async function loadImage(file: File): Promise<void> {
  bitmap?.close();
  bitmap = await createImageBitmap(file);
  sourceName = file.name;
  editor = new TextureAtlasEditor(createTextureAtlasDocument(bitmap.width, bitmap.height));
  editor.addEventListener('change', refresh);
  editor.addEventListener('selection', refresh);
  imageInfo.textContent = `${file.name} · ${bitmap.width} × ${bitmap.height}`;
  empty.hidden = true;
  stage.hidden = false;
  setStatus(`Loaded ${file.name}`);
  refresh();
}

function canvasPoint(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height),
  };
}

function hitFrame(x: number, y: number): TextureAtlasFrame | null {
  if (!editor) return null;
  return [...editor.value.frames].reverse().find((frame) =>
    x >= frame.rect.x
    && y >= frame.rect.y
    && x <= frame.rect.x + frame.rect.width
    && y <= frame.rect.y + frame.rect.height,
  ) ?? null;
}

canvas.addEventListener('pointerdown', (event) => {
  if (!editor) return;
  const point = canvasPoint(event);
  const frame = hitFrame(point.x, point.y);
  if (!frame) {
    editor.select([]);
    refresh();
    return;
  }
  if (!editor.selected.includes(frame.id)) editor.select([frame.id]);
  const handleSize = 10 / zoom;
  const resize = point.x >= frame.rect.x + frame.rect.width - handleSize
    && point.y >= frame.rect.y + frame.rect.height - handleSize;
  drag = {
    frameId: frame.id,
    mode: resize ? 'resize' : 'move',
    startX: point.x,
    startY: point.y,
    original: { ...frame.rect },
    preview: { ...frame.rect },
  };
  canvas.setPointerCapture(event.pointerId);
  refresh();
});

canvas.addEventListener('pointermove', (event) => {
  if (!drag || !editor) return;
  const point = canvasPoint(event);
  const deltaX = Math.round(point.x - drag.startX);
  const deltaY = Math.round(point.y - drag.startY);
  const atlas = editor.value;
  if (drag.mode === 'move') {
    drag.preview = {
      ...drag.original,
      x: Math.max(0, Math.min(atlas.imageWidth - drag.original.width, drag.original.x + deltaX)),
      y: Math.max(0, Math.min(atlas.imageHeight - drag.original.height, drag.original.y + deltaY)),
    };
  } else {
    drag.preview = {
      ...drag.original,
      width: Math.max(1, Math.min(atlas.imageWidth - drag.original.x, drag.original.width + deltaX)),
      height: Math.max(1, Math.min(atlas.imageHeight - drag.original.y, drag.original.height + deltaY)),
    };
  }
  draw();
});

function finishDrag(event: PointerEvent): void {
  if (!drag || !editor) return;
  const current = drag;
  drag = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  editor.updateFrame(current.frameId, { rect: current.preview }, current.mode === 'move' ? 'Move frame' : 'Resize frame');
  refresh();
}
canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  imageInput.value = '';
  if (file) void loadImage(file).catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
});

importButton.addEventListener('click', () => jsonInput.click());
jsonInput.addEventListener('change', async () => {
  const file = jsonInput.files?.[0];
  jsonInput.value = '';
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (!bitmap) throw new Error('Load the source image before importing atlas JSON.');
    if (value.imageWidth !== bitmap.width || value.imageHeight !== bitmap.height) {
      throw new Error('Atlas JSON dimensions do not match the loaded source image.');
    }
    editor = new TextureAtlasEditor(value);
    editor.addEventListener('change', refresh);
    editor.addEventListener('selection', refresh);
    setStatus(`Imported ${file.name}`);
    refresh();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

exportButton.addEventListener('click', () => {
  if (!editor) return;
  const blob = new Blob([editor.serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sourceName.replace(/\.[^.]+$/, '') || 'texture'}-atlas.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`Exported ${anchor.download}`);
});

addButton.addEventListener('click', () => {
  if (!editor) return;
  const atlas = editor.value;
  const width = Math.max(1, Math.floor(atlas.imageWidth / 4));
  const height = Math.max(1, Math.floor(atlas.imageHeight / 4));
  editor.addFrame({
    x: Math.floor((atlas.imageWidth - width) / 2),
    y: Math.floor((atlas.imageHeight - height) / 2),
    width,
    height,
  });
  setStatus('Added frame');
});

gridButton.addEventListener('click', () => {
  if (!editor) return;
  const columns = Number(prompt('Grid columns', '4'));
  const rows = Number(prompt('Grid rows', '4'));
  const padding = Number(prompt('Outer padding in pixels', '0'));
  const spacing = Number(prompt('Cell spacing in pixels', '0'));
  if (![columns, rows, padding, spacing].every(Number.isFinite)) return;
  try {
    const frames = editor.sliceGrid({ columns, rows, padding, spacing, prefix: 'Frame' });
    setStatus(`Created ${frames.length} grid frames`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

detectButton.addEventListener('click', () => {
  if (!bitmap || !editor) return;
  const source = document.createElement('canvas');
  source.width = bitmap.width;
  source.height = bitmap.height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true })!;
  sourceContext.drawImage(bitmap, 0, 0);
  const alpha = sourceContext.getImageData(0, 0, source.width, source.height).data.filter((_, index) => index % 4 === 3);
  const regions = detectTextureAtlasRegions(alpha, source.width, source.height, {
    threshold: 1,
    minimumPixels: 4,
    padding: 1,
    connectivity: 8,
  });
  editor.replaceWithDetectedRegions(regions, 'Region');
  setStatus(`Detected ${regions.length} alpha regions`);
});

duplicateButton.addEventListener('click', () => {
  const created = editor?.duplicateFrames(editor.selected) ?? [];
  if (created.length) setStatus(`Duplicated ${created.length} frame${created.length === 1 ? '' : 's'}`);
});
deleteButton.addEventListener('click', () => {
  if (!editor?.selected.length) return;
  const count = editor.selected.length;
  editor.removeFrames(editor.selected);
  setStatus(`Deleted ${count} frame${count === 1 ? '' : 's'}`);
});
undoButton.addEventListener('click', () => { editor?.undo(); refresh() });
redoButton.addEventListener('click', () => { editor?.redo(); refresh() });
searchInput.addEventListener('input', renderFrameList);
zoomInput.addEventListener('input', () => {
  zoom = Number(zoomInput.value) / 100;
  zoomOutput.textContent = `${zoomInput.value}%`;
  draw();
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.matches('input,textarea')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? editor?.redo() : editor?.undo();
    refresh();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'y') {
    event.preventDefault();
    editor?.redo();
    refresh();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (editor?.selected.length) {
      event.preventDefault();
      editor.removeFrames(editor.selected);
      refresh();
    }
  }
});

refresh();

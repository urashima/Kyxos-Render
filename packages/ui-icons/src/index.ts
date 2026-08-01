export type KxIconName =
  | 'brand' | 'projects' | 'save' | 'undo' | 'redo' | 'authoring' | 'focus'
  | 'select' | 'move' | 'rotate' | 'scale' | 'world' | 'snap' | 'frame' | 'orbit'
  | 'search' | 'publish' | 'more' | 'close' | 'chevron' | 'assets' | 'material'
  | 'texture' | 'animation' | 'environment' | 'preset' | 'console' | 'performance'
  | 'theme' | 'command' | 'reset' | 'fullscreen' | 'play' | 'pause' | 'warning'
  | 'error' | 'success' | 'info' | 'hierarchy' | 'inspector' | 'upload';

const paths: Record<KxIconName, string> = {
  brand: '<path d="M4 4h5v7l6-7h6l-7 8 7 8h-6l-6-7v7H4z"/>',
  projects: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 9h18"/>',
  save: '<path d="M5 3h12l3 3v15H4V3z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/>',
  authoring: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16M8 15h8"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><circle cx="12" cy="12" r="3"/>',
  select: '<path d="m5 3 13 9-6 1 3 6-3 2-3-6-4 4z"/>',
  move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M22 12l-3-3M22 12l-3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3"/>',
  rotate: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/>',
  scale: '<path d="M4 15v5h5M20 9V4h-5M14 10l6-6M4 20l6-6"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  snap: '<path d="M6 3h5v7a2 2 0 0 0 4 0V3h5v7a7 7 0 0 1-14 0z"/><path d="M6 7h5M15 7h5"/>',
  frame: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5"/><path d="M12 2a10 10 0 0 1 0 20"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  publish: '<path d="M12 16V3M7 8l5-5 5 5"/><path d="M4 14v7h16v-7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  assets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  material: '<path d="m12 3 8 5v8l-8 5-8-5V8z"/><path d="m4 8 8 5 8-5M12 13v8"/>',
  texture: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="8" r="2"/>',
  animation: '<path d="M8 5v14l11-7z"/><path d="M4 4v16"/>',
  environment: '<circle cx="12" cy="12" r="9"/><path d="M3 14h18M6 9h12M9 4v16M15 4v16"/>',
  preset: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z"/>',
  console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  performance: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-5"/><circle cx="12" cy="18" r="1"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  command: '<path d="M8 8h8v8H8z"/><path d="M8 8V5a3 3 0 1 0-3 3h3M16 8V5a3 3 0 1 1 3 3h-3M8 16v3a3 3 0 1 1-3-3h3M16 16v3a3 3 0 1 0 3-3h-3"/>',
  reset: '<path d="M4 4v6h6"/><path d="M5 10a8 8 0 1 1 2 8"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  warning: '<path d="m12 3 10 18H2z"/><path d="M12 9v5M12 18h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  hierarchy: '<path d="M5 4h5v5H5zM14 15h5v5h-5zM5 15h5v5H5z"/><path d="M7.5 9v3h9v3M7.5 12v3"/>',
  inspector: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v5h16v-5"/>'
};

export function createKxIcon(name: KxIconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', name === 'brand' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', name === 'brand' ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  svg.classList.add('kx-icon');
  svg.innerHTML = paths[name];
  return svg;
}

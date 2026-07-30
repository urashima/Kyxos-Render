export function element<K extends keyof HTMLElementTagNameMap>(tag: K, options: { className?: string; text?: string; attrs?: Record<string, string>; on?: Partial<Record<keyof HTMLElementEventMap, EventListener>> } = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (options.className) node.className = options.className; if (options.text != null) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  for (const [name, listener] of Object.entries(options.on ?? {})) node.addEventListener(name, listener as EventListener);
  return node;
}
export function button(label: string, action: () => void, className = ''): HTMLButtonElement { return element('button', { className, text: label, attrs: { type: 'button' }, on: { click: action } }) }
export function setBusy(node: HTMLElement, busy: boolean, label?: string): void { node.toggleAttribute('aria-busy', busy); node.classList.toggle('is-busy', busy); if (label) node.setAttribute('data-busy-label', label) }
export function safeText(value: unknown): string { return String(value ?? '').replace(/[<>]/g, '') }
export function downloadBlob(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

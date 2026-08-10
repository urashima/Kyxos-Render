export {};

const completeMaterialSectionIds = new Set([
  'material-advanced-complete',
  'material-extension-textures',
]);

function openCompleteMaterialSections(root: ParentNode = document): void {
  for (const section of root.querySelectorAll<HTMLDetailsElement>(
    'details.inspector-section[data-schema-section]',
  )) {
    if (!completeMaterialSectionIds.has(section.dataset.schemaSection ?? '')) continue;
    section.open = true;
    section.dataset.materialSectionReady = 'true';
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('details.inspector-section[data-schema-section]')) {
        openCompleteMaterialSections(node.parentNode ?? document);
      } else {
        openCompleteMaterialSections(node);
      }
    }
  }
});

function install(): void {
  openCompleteMaterialSections();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) install();
else window.addEventListener('DOMContentLoaded', install, { once: true });

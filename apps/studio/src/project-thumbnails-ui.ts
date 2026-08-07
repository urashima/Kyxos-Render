import './project-thumbnails-ui.css';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';

const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
const client = backendConfig.error
  ? null
  : createDurableApiClient({
      url: backendConfig.supabaseUrl,
      anonKey: backendConfig.supabaseAnonKey,
      functionsUrl: backendConfig.functionsUrl,
    });

let generation = 0;

async function hydrateProjectThumbnails(screen: HTMLElement): Promise<void> {
  if (!client || screen.dataset.kxProjectThumbnails === 'loading' || screen.dataset.kxProjectThumbnails === 'ready') return;
  screen.dataset.kxProjectThumbnails = 'loading';
  const currentGeneration = ++generation;
  try {
    const projects = await client.projects.list();
    if (!screen.isConnected || currentGeneration !== generation) return;
    const cards = [...screen.querySelectorAll<HTMLElement>('.project-card')];
    cards.forEach((card, index) => {
      const project = projects[index];
      if (!project) return;
      card.dataset.projectId = project.id;
      const thumb = card.querySelector<HTMLElement>('.project-thumb');
      if (!thumb) return;
      thumb.dataset.hasThumbnail = String(Boolean(project.thumbnail));
      if (!project.thumbnail) return;
      const image = document.createElement('img');
      image.src = project.thumbnail;
      image.alt = `${project.name} scene thumbnail`;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.addEventListener('load', () => {
        thumb.replaceChildren(image);
        thumb.dataset.thumbnailLoaded = 'true';
      }, { once: true });
      image.addEventListener('error', () => {
        thumb.dataset.thumbnailLoaded = 'false';
      }, { once: true });
    });
    screen.dataset.kxProjectThumbnails = 'ready';
  } catch {
    // Project list already owns auth/error handling. Thumbnail hydration must never block navigation.
    screen.dataset.kxProjectThumbnails = 'unavailable';
  }
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.projects-screen').forEach((screen) => {
    void hydrateProjectThumbnails(screen);
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();

import { createKyxosApiClient } from '@kyxos/api-client';
import { mountStudioApp } from '@kyxos/studio-ui';
import { KyxosViewer } from '@kyxos/viewer';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Studio root not found.');

const apiClient = createKyxosApiClient({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

void mountStudioApp({
  root,
  apiClient,
  publicBaseUrl: `${window.location.origin}${import.meta.env.BASE_URL.replace(/studio\/?$/, '')}`,
  createViewer: async (canvas) =>
    KyxosViewer.create({
      canvas,
      backend: 'auto',
      quality: 'high',
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    }),
});

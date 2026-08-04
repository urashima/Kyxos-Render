import { describe, expect, it } from 'vitest';
import { resolveKyxosRuntimeBackendConfig } from '../../packages/api-client/src/runtimeConfig';

describe('runtime backend configuration', () => {
  it('uses Supabase and derives both Edge Function URLs', () => {
    expect(resolveKyxosRuntimeBackendConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co/',
      VITE_SUPABASE_ANON_KEY: 'public-anon-key',
      VITE_KYXOS_REQUIRE_REMOTE: '1',
    })).toMatchObject({
      provider: 'supabase',
      functionsUrl: 'https://example.supabase.co/functions/v1',
      publicFunctionUrl: 'https://example.supabase.co/functions/v1/public-scene',
      requireRemote: true,
      error: undefined,
    });
  });

  it('blocks production instead of silently selecting browser-local persistence', () => {
    const config = resolveKyxosRuntimeBackendConfig({ VITE_KYXOS_REQUIRE_REMOTE: '1' });
    expect(config.provider).toBe('local');
    expect(config.error).toContain('VITE_SUPABASE_URL');
    expect(config.error).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('retains the explicit local provider for acceptance builds', () => {
    expect(resolveKyxosRuntimeBackendConfig({})).toMatchObject({
      provider: 'local',
      requireRemote: false,
      error: undefined,
    });
  });
});

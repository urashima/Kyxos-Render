export interface KyxosRuntimeEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_KYXOS_FUNCTIONS_URL?: string;
  VITE_KYXOS_PUBLIC_FUNCTION_URL?: string;
  VITE_KYXOS_REQUIRE_REMOTE?: string;
}

export interface KyxosRuntimeBackendConfig {
  provider: 'local' | 'supabase';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  functionsUrl?: string;
  publicFunctionUrl?: string;
  requireRemote: boolean;
  error?: string;
}

function value(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.trim();
  return normalized || undefined;
}

function appendPath(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function resolveKyxosRuntimeBackendConfig(
  environment: KyxosRuntimeEnvironment,
): KyxosRuntimeBackendConfig {
  const supabaseUrl = value(environment.VITE_SUPABASE_URL);
  const supabaseAnonKey = value(environment.VITE_SUPABASE_ANON_KEY);
  const requireRemote = environment.VITE_KYXOS_REQUIRE_REMOTE === '1';
  const provider = supabaseUrl && supabaseAnonKey ? 'supabase' : 'local';
  const functionsUrl = value(environment.VITE_KYXOS_FUNCTIONS_URL)
    ?? (supabaseUrl ? appendPath(supabaseUrl, 'functions/v1') : undefined);
  const publicFunctionUrl = value(environment.VITE_KYXOS_PUBLIC_FUNCTION_URL)
    ?? (functionsUrl ? appendPath(functionsUrl, 'public-scene') : undefined);

  let error: string | undefined;
  if (requireRemote && provider !== 'supabase') {
    const missing = [
      !supabaseUrl ? 'VITE_SUPABASE_URL' : '',
      !supabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY' : '',
    ].filter(Boolean).join(', ');
    error = `Kyxos cloud backend is not configured. Missing ${missing}. `
      + 'This production build will not fall back to browser-only project storage.';
  }

  return {
    provider,
    supabaseUrl,
    supabaseAnonKey,
    functionsUrl,
    publicFunctionUrl,
    requireRemote,
    error,
  };
}

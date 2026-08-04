from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "apps/studio/src/main.ts",
    "import { createDurableApiClient } from '@kyxos/api-client/durable';\n",
    "import { createDurableApiClient } from '@kyxos/api-client/durable';\n"
    "import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';\n",
)
replace_once(
    "apps/studio/src/main.ts",
    "const app = document.querySelector<HTMLElement>('#app')!;\n"
    "const client = createDurableApiClient({\n"
    "  url: import.meta.env.VITE_SUPABASE_URL,\n"
    "  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,\n"
    "  functionsUrl: import.meta.env.VITE_KYXOS_FUNCTIONS_URL,\n"
    "});\n\n"
    "const offlineStore = createIndexedDbDraftStore();\n"
    "let disposeCurrentScreen: (() => void) | null = null;\n\n"
    "void boot();\n",
    "const app = document.querySelector<HTMLElement>('#app')!;\n"
    "const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);\n"
    "document.documentElement.dataset.apiProvider = backendConfig.provider;\n"
    "const client = createDurableApiClient({\n"
    "  url: backendConfig.supabaseUrl,\n"
    "  anonKey: backendConfig.supabaseAnonKey,\n"
    "  functionsUrl: backendConfig.functionsUrl,\n"
    "});\n\n"
    "const offlineStore = createIndexedDbDraftStore();\n"
    "let disposeCurrentScreen: (() => void) | null = null;\n\n"
    "if (backendConfig.error) renderBackendConfigurationError(backendConfig.error);\n"
    "else void boot();\n\n"
    "function renderBackendConfigurationError(message: string): void {\n"
    "  const panel = element('section', { className: 'auth-card' });\n"
    "  panel.innerHTML = [\n"
    "    '<div class=\"brand-mark\">K</div>',\n"
    "    '<h1>Cloud backend unavailable</h1>',\n"
    "    `<p>${safeText(message)}</p>`,\n"
    "    '<small>Projects and published releases are intentionally blocked instead of being saved only in this browser.</small>',\n"
    "  ].join('');\n"
    "  const screen = element('main', { className: 'auth-screen' });\n"
    "  screen.append(panel);\n"
    "  app.replaceChildren(screen);\n"
    "}\n",
)
replace_once(
    "apps/studio/src/main.ts",
    "    '<small>Without Supabase variables, this preview uses the local acceptance provider.</small>',\n",
    "    `<small>${backendConfig.provider === 'supabase'\n"
    "      ? 'Cloud workspace · projects, drafts, assets and releases are stored on the server.'\n"
    "      : 'Local acceptance workspace · data exists only in this browser.'}</small>`,\n",
)

replace_once(
    "apps/public-viewer/src/main.ts",
    "import { createDurableApiClient } from '@kyxos/api-client/durable';\n",
    "import { createDurableApiClient } from '@kyxos/api-client/durable';\n"
    "import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';\n",
)
replace_once(
    "apps/public-viewer/src/main.ts",
    "const embed = location.pathname.includes('/embed') || params.get('ui') === '0';\n"
    "const publicFunctionUrl = import.meta.env.VITE_KYXOS_PUBLIC_FUNCTION_URL as string | undefined;\n"
    "const client = createDurableApiClient({\n"
    "  url: import.meta.env.VITE_SUPABASE_URL,\n"
    "  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,\n"
    "  functionsUrl: import.meta.env.VITE_KYXOS_FUNCTIONS_URL,\n"
    "});\n",
    "const embed = location.pathname.includes('/embed') || params.get('ui') === '0';\n"
    "const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);\n"
    "document.documentElement.dataset.apiProvider = backendConfig.provider;\n"
    "const publicFunctionUrl = backendConfig.publicFunctionUrl;\n"
    "const client = createDurableApiClient({\n"
    "  url: backendConfig.supabaseUrl,\n"
    "  anonKey: backendConfig.supabaseAnonKey,\n"
    "  functionsUrl: backendConfig.functionsUrl,\n"
    "});\n",
)
replace_once(
    "apps/public-viewer/src/main.ts",
    "  const versionId = params.get('release');\n"
    "  const slug = params.get('slug') ?? routeSlug;\n",
    "  if (backendConfig.error) throw new Error(backendConfig.error);\n"
    "  const versionId = params.get('release');\n"
    "  const slug = params.get('slug') ?? routeSlug;\n",
)

replace_once(
    "packages/api-client/src/index.ts",
    "    upload: async (ticket: UploadTicket, file: Blob): Promise<void> => {\n"
    "      if (ticket.alreadyExists) return;\n"
    "      if (!ticket.uploadUrl) throw new Error('Signed upload URL is missing.');\n"
    "      const form = new FormData();\n"
    "      form.append('cacheControl', '31536000');\n"
    "      form.append('', file);\n"
    "      const response = await fetch(ticket.uploadUrl, {\n"
    "        method: 'PUT',\n"
    "        headers: { 'x-upsert': 'false', ...(ticket.headers ?? {}) },\n"
    "        body: form,\n"
    "      });\n"
    "      if (!response.ok) {\n"
    "        throw new Error(`Signed asset upload failed (${response.status}).`);\n"
    "      }\n"
    "    },\n",
    "    upload: async (ticket: UploadTicket, file: Blob): Promise<void> => {\n"
    "      if (ticket.alreadyExists) return;\n"
    "      if (!ticket.uploadToken) throw new Error('Signed upload token is missing.');\n"
    "      const { error } = await this.realtimeClient.storage\n"
    "        .from('kyxos-assets')\n"
    "        .uploadToSignedUrl(ticket.storageKey, ticket.uploadToken, file, {\n"
    "          cacheControl: '31536000',\n"
    "          contentType: file.type || 'application/octet-stream',\n"
    "        });\n"
    "      if (error) throw new Error(`Signed asset upload failed: ${error.message}`);\n"
    "    },\n",
)

path = Path("docs/DEPLOYMENT.md")
text = path.read_text()
needle = "Frontend build variables:\n\n```text\nVITE_SUPABASE_URL\nVITE_SUPABASE_ANON_KEY\nVITE_KYXOS_FUNCTIONS_URL\nVITE_KYXOS_PUBLIC_FUNCTION_URL\n```\n"
addition = needle + "\nGitHub Pages production reads `KYXOS_SUPABASE_URL` and `KYXOS_SUPABASE_ANON_KEY` from repository Variables or Secrets. Production sets `VITE_KYXOS_REQUIRE_REMOTE=1` and fails before deployment when either value or either required Edge Function is unavailable. Browser-local persistence is acceptance-only and must never be presented as production publishing.\n"
if needle not in text:
    raise SystemExit("Deployment frontend-variable section not found")
path.write_text(text.replace(needle, addition, 1))

Path("tests/unit/runtime-backend-config.spec.ts").write_text("""import { describe, expect, it } from 'vitest';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';

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
""")

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


# Studio must identify its actual provider and refuse browser-only persistence in production.
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

# Public Viewer derives the anonymous resolver from the same production backend.
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

# Use Supabase's supported signed-upload API. The previous raw FormData request ignored uploadToken.
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

# Production Pages must receive cloud values and must never silently publish a browser-local site.
replace_once(
    ".github/workflows/deploy-main-pages.yml",
    "    runs-on: ubuntu-latest\n"
    "    timeout-minutes: 45\n",
    "    runs-on: ubuntu-latest\n"
    "    timeout-minutes: 45\n"
    "    env:\n"
    "      VITE_SUPABASE_URL: ${{ vars.KYXOS_SUPABASE_URL || secrets.KYXOS_SUPABASE_URL }}\n"
    "      VITE_SUPABASE_ANON_KEY: ${{ vars.KYXOS_SUPABASE_ANON_KEY || secrets.KYXOS_SUPABASE_ANON_KEY }}\n"
    "      VITE_KYXOS_FUNCTIONS_URL: ${{ vars.KYXOS_FUNCTIONS_URL }}\n"
    "      VITE_KYXOS_PUBLIC_FUNCTION_URL: ${{ vars.KYXOS_PUBLIC_FUNCTION_URL }}\n"
    "      VITE_KYXOS_REQUIRE_REMOTE: '1'\n",
)
replace_once(
    ".github/workflows/deploy-main-pages.yml",
    "      - name: Checkout main\n"
    "        uses: actions/checkout@v4\n\n"
    "      - uses: pnpm/action-setup@v4\n",
    "      - name: Checkout main\n"
    "        uses: actions/checkout@v4\n\n"
    "      - name: Require production cloud backend\n"
    "        shell: bash\n"
    "        run: |\n"
    "          missing=()\n"
    "          [[ -n \"$VITE_SUPABASE_URL\" ]] || missing+=(KYXOS_SUPABASE_URL)\n"
    "          [[ -n \"$VITE_SUPABASE_ANON_KEY\" ]] || missing+=(KYXOS_SUPABASE_ANON_KEY)\n"
    "          if (( ${#missing[@]} )); then\n"
    "            echo \"Production Pages cannot use browser-local persistence. Missing repository variables/secrets: ${missing[*]}\" >&2\n"
    "            exit 1\n"
    "          fi\n"
    "          case \"$VITE_SUPABASE_URL\" in\n"
    "            https://*.supabase.co) ;;\n"
    "            *) echo 'KYXOS_SUPABASE_URL must be an https://*.supabase.co project URL.' >&2; exit 1 ;;\n"
    "          esac\n\n"
    "      - name: Verify deployed Supabase functions\n"
    "        shell: bash\n"
    "        run: |\n"
    "          function_base=\"${VITE_KYXOS_FUNCTIONS_URL:-${VITE_SUPABASE_URL%/}/functions/v1}\"\n"
    "          api_status=$(curl --silent --output /tmp/kyxos-api.json --write-out '%{http_code}' \\\n"
    "            -H \"apikey: $VITE_SUPABASE_ANON_KEY\" \\\n"
    "            \"${function_base%/}/kyxos-api/projects\")\n"
    "          public_status=$(curl --silent --output /tmp/public-scene.json --write-out '%{http_code}' \\\n"
    "            \"${function_base%/}/public-scene\")\n"
    "          [[ \"$api_status\" == '401' || \"$api_status\" == '403' ]] || { cat /tmp/kyxos-api.json; echo \"kyxos-api is unavailable (HTTP $api_status).\" >&2; exit 1; }\n"
    "          [[ \"$public_status\" == '400' ]] || { cat /tmp/public-scene.json; echo \"public-scene is unavailable (HTTP $public_status).\" >&2; exit 1; }\n\n"
    "      - uses: pnpm/action-setup@v4\n",
)

# PR previews may use cloud credentials when configured, while UI fixtures remain buildable without secrets.
replace_once(
    ".github/workflows/deploy-pr-preview.yml",
    "      STUDIO_LEGACY_URL: https://urashima.github.io/Kyxos-Render/preview/pr-12/studio/\n",
    "      STUDIO_LEGACY_URL: https://urashima.github.io/Kyxos-Render/preview/pr-12/studio/\n"
    "      VITE_SUPABASE_URL: ${{ vars.KYXOS_SUPABASE_URL || secrets.KYXOS_SUPABASE_URL }}\n"
    "      VITE_SUPABASE_ANON_KEY: ${{ vars.KYXOS_SUPABASE_ANON_KEY || secrets.KYXOS_SUPABASE_ANON_KEY }}\n"
    "      VITE_KYXOS_FUNCTIONS_URL: ${{ vars.KYXOS_FUNCTIONS_URL }}\n"
    "      VITE_KYXOS_PUBLIC_FUNCTION_URL: ${{ vars.KYXOS_PUBLIC_FUNCTION_URL }}\n"
    "      VITE_KYXOS_REQUIRE_REMOTE: '0'\n",
)

# Document the deployment contract plainly.
path = Path("docs/DEPLOYMENT.md")
text = path.read_text()
needle = "Frontend build variables:\n\n```text\nVITE_SUPABASE_URL\nVITE_SUPABASE_ANON_KEY\nVITE_KYXOS_FUNCTIONS_URL\nVITE_KYXOS_PUBLIC_FUNCTION_URL\n```\n"
addition = needle + "\nGitHub Pages production reads `KYXOS_SUPABASE_URL` and `KYXOS_SUPABASE_ANON_KEY` from repository Variables (preferred for these public browser values) or Secrets. The production build sets `VITE_KYXOS_REQUIRE_REMOTE=1` and fails before deployment when either value or either required Edge Function is unavailable. Local browser persistence is acceptance-only and must never be presented as production publishing.\n"
if needle not in text:
    raise SystemExit("Deployment frontend-variable section not found")
path.write_text(text.replace(needle, addition, 1))

# Add deterministic config coverage.
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

# Ensure the focused smoke suite sees the new files and unit test.
replace_once(
    ".github/workflows/studio-glb-import-smoke.yml",
    "      - 'packages/api-client/**'\n",
    "      - 'packages/api-client/**'\n"
    "      - 'tests/unit/runtime-backend-config.spec.ts'\n",
)
replace_once(
    ".github/workflows/studio-glb-import-smoke.yml",
    "          tests/unit/studio-import-lifecycle.spec.ts\n",
    "          tests/unit/runtime-backend-config.spec.ts\n"
    "          tests/unit/studio-import-lifecycle.spec.ts\n",
)

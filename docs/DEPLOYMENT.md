# Deployment

## Local acceptance

```bash
corepack enable
pnpm install --no-frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:visual
pnpm build:pages
node scripts/serve-site.mjs
```

The combined acceptance site exposes:

- `/latest/` — Kyxos Viewer Playground
- `/studio/` — Kyxos Studio
- `/public/?release=<version-id>` — current/fixed Public Viewer acceptance route
- `/embed/?release=<version-id>&ui=0` — Embed Viewer

`site/build-report.json` records JavaScript, CSS and total bytes for each product.

## Supabase

Required secrets and variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
KYXOS_ALLOWED_ORIGINS
KYXOS_PUBLIC_ALLOWED_ORIGINS
KYXOS_MAX_UPLOAD_BYTES
```

Frontend build variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_KYXOS_FUNCTIONS_URL
VITE_KYXOS_PUBLIC_FUNCTION_URL
```

GitHub Pages production reads `KYXOS_SUPABASE_URL` and `KYXOS_SUPABASE_ANON_KEY` from repository Variables or Secrets. Production sets `VITE_KYXOS_REQUIRE_REMOTE=1` and fails before deployment when either value or either required Edge Function is unavailable. Browser-local persistence is acceptance-only and must never be presented as production publishing.

Optional live two-user RLS acceptance variables:

```text
KYXOS_SUPABASE_URL
KYXOS_SUPABASE_ANON_KEY
KYXOS_RLS_OWNER_EMAIL
KYXOS_RLS_OWNER_PASSWORD
KYXOS_RLS_SECOND_EMAIL
KYXOS_RLS_SECOND_PASSWORD
```

The two accounts must already exist and use disposable acceptance credentials. The integration suite creates an isolated project, proves the second user can write as Editor, demotes that same user to Viewer, proves the write is blocked while reads remain available, and then removes the isolated project. Do not use the Service Role key for this test; doing so would bypass RLS.

Deploy in order:

```bash
supabase db push
supabase functions deploy kyxos-api
supabase functions deploy public-scene --no-verify-jwt
supabase db reset --local   # local/CI only; loads migrations and seed
```

After deploying the migration, enable private-channel authorization in the Supabase Realtime settings. The client subscribes to `project:<uuid>` with `private: true`; `realtime.messages` policies authorize Presence for project members and Broadcast writes only for Owner/Editor roles. Run `pnpm test:integration` with the six live acceptance variables before production promotion.

Never expose the Service Role key to Vite, browser builds or RLS acceptance tests. Storage remains private; upload and public download URLs are short-lived signatures. The public function verifies that the requested version belongs to an enabled public slug before signing only the assets pinned by that version.

## GitHub Pages and preview rule

`.github/workflows/ci-pages.yml` runs lint, formatting, typecheck, unit/contract/integration tests, boundary/license/contract verification, builds every product, runs Chromium E2E and uploads the combined Pages artifact. Pushes to `main` deploy the stable Pages site. The development branch also receives a branch preview artifact; each change must be validated there before merge.

Production route mapping may rewrite:

```text
/s/<slug>                    → Public Viewer with slug
/s/<slug>/v/<version-id>     → Public Viewer with fixed version
/embed/<version-id>          → Embed Viewer with fixed version
```

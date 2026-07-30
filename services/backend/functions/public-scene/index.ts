import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigins = new Set(
  (Deno.env.get('KYXOS_PUBLIC_ALLOWED_ORIGINS') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
);

function headers(request: Request, cache = 'public, max-age=60, stale-while-revalidate=300') {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigins.size === 0 || allowedOrigins.has(origin);
  return {
    'access-control-allow-origin': allowed ? origin || '*' : '',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': cache,
    'content-type': 'application/json',
    vary: 'origin',
  };
}

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request, 'no-store') });
  if (request.method !== 'GET') return response(request, { error: 'method not allowed' }, 405);

  const url = new URL(request.url);
  const versionId = url.searchParams.get('version');
  const slug = url.searchParams.get('slug');
  if (!versionId && !slug) return response(request, { error: 'version or slug is required' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let resolvedVersionId = versionId;
    let slugRow: { project_id: string; slug: string; current_version_id: string; allowed_embed_origins: string[] } | null = null;

    if (slug) {
      const { data, error } = await admin
        .from('public_slugs')
        .select('project_id,slug,current_version_id,allowed_embed_origins')
        .eq('slug', slug)
        .eq('is_enabled', true)
        .single();
      if (error || !data) return response(request, { error: 'published link not found' }, 404);
      slugRow = data;
      resolvedVersionId = data.current_version_id;
    }

    const { data: version, error: versionError } = await admin
      .from('published_versions')
      .select('id,project_id,version_number,scene_snapshot,scene_digest,contract_version,viewer_compatibility,created_at')
      .eq('id', resolvedVersionId)
      .single();
    if (versionError || !version) return response(request, { error: 'published version not found' }, 404);

    if (!slugRow) {
      const { data, error } = await admin
        .from('public_slugs')
        .select('project_id,slug,current_version_id,allowed_embed_origins')
        .eq('project_id', version.project_id)
        .eq('is_enabled', true)
        .single();
      if (error || !data) return response(request, { error: 'public access is disabled' }, 404);
      slugRow = data;
    }

    const { data: publishedAssets, error: assetsError } = await admin
      .from('published_assets')
      .select('asset_id,assets!inner(content_hash,storage_key)')
      .eq('version_id', version.id);
    if (assetsError) throw assetsError;

    const manifest: Record<string, string> = {};
    for (const row of publishedAssets ?? []) {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      if (!asset) continue;
      const { data: signed, error: signedError } = await admin.storage
        .from('kyxos-assets')
        .createSignedUrl(asset.storage_key, 900);
      if (signedError || !signed) throw signedError ?? new Error('Unable to sign a published asset.');
      manifest[`asset://${asset.content_hash}`] = signed.signedUrl;
    }

    return response(request, {
      release: {
        id: version.id,
        projectId: version.project_id,
        versionNumber: version.version_number,
        sceneSnapshot: version.scene_snapshot,
        sceneDigest: version.scene_digest,
        slug: slugRow.slug,
        createdAt: version.created_at,
        isCurrent: slugRow.current_version_id === version.id,
      },
      manifest: { assets: manifest },
      embed: { allowedOrigins: slugRow.allowed_embed_origins ?? [] },
    });
  } catch (error) {
    console.error(error);
    return response(request, { error: 'published scene could not be resolved' }, 500);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASSET_BUCKET = 'kyxos-assets';
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('KYXOS_PUBLIC_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin') ?? '';
  return !origin || ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin);
}

function headers(
  request: Request,
  cache = 'public, max-age=60, stale-while-revalidate=300',
): HeadersInit {
  const origin = request.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': originAllowed(request) ? origin || '*' : 'null',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'cache-control': cache,
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    vary: 'origin',
  };
}

function response(
  request: Request,
  body: unknown,
  status = 200,
  cache?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request, cache),
  });
}

function validUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function isPersistentSnapshotAsset(asset: any): boolean {
  const metadata = asset?.metadata ?? {};
  const id = String(asset?.id ?? '');
  const hash = String(asset?.contentHash ?? '');
  return (
    /^[a-f0-9]{64}$/.test(hash) &&
    metadata.embedded !== true &&
    !metadata.embeddedInAssetId &&
    asset?.storageType !== 'virtual' &&
    asset?.runtimeOnly !== true &&
    !id.startsWith('embedded-gltf-')
  );
}

function expectedAssetHashes(snapshot: any): Set<string> {
  return new Set(
    Object.values(snapshot?.assets ?? {})
      .filter(isPersistentSnapshotAsset)
      .map((asset: any) => String(asset.contentHash ?? '')),
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return originAllowed(request)
      ? new Response(null, { status: 204, headers: headers(request, 'no-store') })
      : response(request, { error: 'origin not allowed' }, 403, 'no-store');
  }
  if (!originAllowed(request)) {
    return response(request, { error: 'origin not allowed' }, 403, 'no-store');
  }
  if (request.method !== 'GET') {
    return response(request, { error: 'method not allowed' }, 405, 'no-store');
  }

  const url = new URL(request.url);
  const versionId = url.searchParams.get('version');
  const slug = url.searchParams.get('slug');
  if ((versionId && slug) || (!versionId && !slug)) {
    return response(
      request,
      { error: 'provide exactly one version or slug' },
      400,
      'no-store',
    );
  }
  if (versionId && !validUuid(versionId)) {
    return response(request, { error: 'invalid version id' }, 400, 'no-store');
  }
  if (slug && !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
    return response(request, { error: 'invalid public slug' }, 400, 'no-store');
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let resolvedVersionId = versionId;
    let slugRow: {
      project_id: string;
      slug: string;
      current_version_id: string;
      allowed_embed_origins: string[];
    } | null = null;

    if (slug) {
      const { data, error } = await admin
        .from('public_slugs')
        .select('project_id,slug,current_version_id,allowed_embed_origins')
        .eq('slug', slug)
        .eq('is_enabled', true)
        .single();
      if (error || !data) {
        return response(request, { error: 'published link not found' }, 404, 'no-store');
      }
      slugRow = data;
      resolvedVersionId = data.current_version_id;
    }

    const { data: version, error: versionError } = await admin
      .from('published_versions')
      .select(
        'id,project_id,version_number,scene_snapshot,scene_digest,contract_version,viewer_compatibility,created_at',
      )
      .eq('id', resolvedVersionId)
      .single();
    if (versionError || !version) {
      return response(request, { error: 'published version not found' }, 404, 'no-store');
    }

    if (!slugRow) {
      const { data, error } = await admin
        .from('public_slugs')
        .select('project_id,slug,current_version_id,allowed_embed_origins')
        .eq('project_id', version.project_id)
        .eq('is_enabled', true)
        .single();
      if (error || !data) {
        return response(request, { error: 'public access is disabled' }, 404, 'no-store');
      }
      slugRow = data;
    }

    const { data: publishedAssets, error: assetsError } = await admin
      .from('published_assets')
      .select('asset_id,assets!inner(content_hash,storage_key,metadata_json)')
      .eq('version_id', version.id);
    if (assetsError) throw assetsError;

    const manifest: Record<string, string> = {};
    const signedByAssetId: Record<string, string> = {};
    for (const row of publishedAssets ?? []) {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      if (!asset || asset.metadata_json?.completed !== true) continue;
      const { data: signed, error: signedError } = await admin.storage
        .from(ASSET_BUCKET)
        .createSignedUrl(asset.storage_key, 900);
      if (signedError || !signed?.signedUrl) {
        throw signedError ?? new Error('Unable to sign a published asset.');
      }
      manifest[`asset://${asset.content_hash}`] = signed.signedUrl;
      signedByAssetId[String(row.asset_id)] = signed.signedUrl;
    }

    // Older Public Viewer builds validate every Contract asset URI before the
    // Viewer can restore native textures from the parent GLB. Provide aliases
    // for embedded glTF child assets while keeping only the parent asset in
    // published_assets. The runtime never downloads these aliases as images.
    for (const snapshotAsset of Object.values(version.scene_snapshot?.assets ?? {}) as any[]) {
      const metadata = snapshotAsset?.metadata ?? {};
      const parentAssetId = String(metadata.embeddedInAssetId ?? '');
      const uri = String(snapshotAsset?.uri ?? '');
      if (
        (metadata.embedded === true || parentAssetId) &&
        parentAssetId &&
        uri.startsWith('asset://') &&
        signedByAssetId[parentAssetId]
      ) {
        manifest[uri] = signedByAssetId[parentAssetId];
      }
    }

    const expected = expectedAssetHashes(version.scene_snapshot);
    const resolved = new Set(
      Object.keys(manifest).map((uri) => uri.slice('asset://'.length)),
    );
    if ([...expected].some((hash) => !resolved.has(hash))) {
      return response(
        request,
        { error: 'published asset manifest is incomplete' },
        503,
        'no-store',
      );
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
    return response(
      request,
      { error: 'published scene could not be resolved' },
      500,
      'no-store',
    );
  }
});

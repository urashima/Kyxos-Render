type KyxosStatusCode = 'KX_OK' | 'KX_ASSET_UPLOAD_FAILED';

interface KyxosResult<T> {
  ok: boolean;
  code: KyxosStatusCode;
  data?: T;
  message?: string;
}

export async function signedUpload(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { path?: string };
  if (!body.path) {
    return Response.json(
      {
        ok: false,
        code: 'KX_ASSET_UPLOAD_FAILED',
        message: 'Missing immutable asset path.',
      } satisfies KyxosResult<null>,
      { status: 400 },
    );
  }

  return Response.json({
    ok: false,
    code: 'KX_ASSET_UPLOAD_FAILED',
    message: 'Deploy with Supabase storage credentials to mint signed upload URLs.',
  } satisfies KyxosResult<null>);
}

export default signedUpload;

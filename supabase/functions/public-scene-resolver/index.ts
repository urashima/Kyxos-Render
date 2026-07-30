type KyxosStatusCode = 'KX_OK' | 'KX_PUBLICATION_NOT_FOUND';

interface KyxosResult<T> {
  ok: boolean;
  code: KyxosStatusCode;
  data?: T;
  message?: string;
}

export async function resolvePublicScene(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug) {
    return Response.json(
      {
        ok: false,
        code: 'KX_PUBLICATION_NOT_FOUND',
        message: 'Missing public scene slug.',
      } satisfies KyxosResult<null>,
      { status: 404 },
    );
  }

  return Response.json({
    ok: false,
    code: 'KX_PUBLICATION_NOT_FOUND',
    message: 'Deploy with SUPABASE_SERVICE_ROLE_KEY to enable database backed public scene resolution.',
  } satisfies KyxosResult<null>);
}

export default resolvePublicScene;

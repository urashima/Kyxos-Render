type KyxosStatusCode = 'KX_OK' | 'KX_PERMISSION_DENIED';

interface KyxosResult<T> {
  ok: boolean;
  code: KyxosStatusCode;
  data?: T;
  message?: string;
}

export async function publishProject(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { projectId?: string; visibility?: string };
  if (!body.projectId) {
    return Response.json(
      { ok: false, code: 'KX_PERMISSION_DENIED', message: 'Missing project id.' } satisfies KyxosResult<null>,
      { status: 403 },
    );
  }

  return Response.json({
    ok: false,
    code: 'KX_PERMISSION_DENIED',
    message: 'Deploy with Supabase service credentials to create immutable scene revisions.',
  } satisfies KyxosResult<null>);
}

export default publishProject;

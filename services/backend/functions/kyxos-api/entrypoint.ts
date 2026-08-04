// Temporary compatibility entrypoint for the production Kyxos Studio API.
// It loads the reviewed API implementation from the immutable merge commit and
// applies the request-JWT fix before the module registers its Deno.serve handler.

const SOURCE_URL =
  'https://raw.githubusercontent.com/urashima/Kyxos-Render/26505bfcb7783feef18777c8a72d9c9059098aca/services/backend/functions/kyxos-api/index.ts';

const response = await fetch(SOURCE_URL, {
  headers: { accept: 'text/plain' },
});
if (!response.ok) {
  throw new Error(`Unable to load the pinned Kyxos API source (${response.status}).`);
}

let source = await response.text();
const oldAuthBlock = `  const authHeader = request.headers.get('authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const {
    data: { user },
  } = await userClient.auth.getUser();
`;
const newAuthBlock = `  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.replace(/^Bearer\\s+/i, '').trim();
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(accessToken);
`;

if (!source.includes(oldAuthBlock)) {
  throw new Error('Pinned Kyxos API source does not contain the expected authentication block.');
}
source = source.replace(oldAuthBlock, newAuthBlock).replace(
  "    if (!user) return json(request, { error: 'authentication required' }, 401);",
  "    if (authError || !user) return json(request, { error: 'authentication required' }, 401);",
);

const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(source)));
await import(`data:application/typescript;base64,${encoded}`);

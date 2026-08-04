import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Supabase signed asset upload', () => {
  it('uses the signed upload token API and only reuses verified hash assets', async () => {
    const client = await readFile('packages/api-client/src/index.ts', 'utf8');
    const backend = await readFile(
      'services/backend/functions/kyxos-api/index.ts',
      'utf8',
    );

    expect(client).toContain("if (!ticket.uploadToken) throw new Error('Signed upload token is missing.')");
    expect(client).toContain(".from('kyxos-assets')");
    expect(client).toContain('.uploadToSignedUrl(ticket.storageKey, ticket.uploadToken, file');
    expect(client).toContain("cacheControl: '31536000'");
    expect(client).toContain("contentType: file.type || 'application/octet-stream'");
    expect(client).not.toContain("form.append('', file)");

    expect(backend).toContain('createSignedUploadUrl(storageKey)');
    expect(backend).toContain('uploadToken');
    expect(backend).toContain('metadata_json?.completed === true');
    expect(backend).toContain('metadata_json: { completed: false }');
    expect(backend).toContain('completed: true');
    expect(backend).toContain("await admin.storage.from(ASSET_BUCKET).remove");
    expect(backend).toContain("await admin.from('assets').delete()");
    expect(backend).toContain('Content hash mismatch.');
  });

  it('authorizes fixed versions through the project public slug rather than current-version joins', async () => {
    const backend = await readFile(
      'services/backend/functions/kyxos-api/index.ts',
      'utf8',
    );

    expect(backend).toContain(".eq('project_id', data.project_id)");
    expect(backend).toContain(".eq('is_enabled', true)");
    expect(backend).not.toContain("published_versions').select('*,public_slugs!inner");
    expect(backend).toContain(".eq('id', body.versionId)");
    expect(backend).toContain(".eq('project_id', body.projectId)");
  });
});

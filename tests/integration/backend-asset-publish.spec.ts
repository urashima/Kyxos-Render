import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Supabase publish asset ownership', () => {
  it('pins only publisher-owned assets and makes publish retries idempotent', async () => {
    const sql = await readFile(
      'services/backend/migrations/0002_publish_asset_ownership.sql',
      'utf8',
    );

    expect(sql).toContain('owner_id = auth.uid()');
    expect(sql).toContain('insert into public.project_assets');
    expect(sql).toContain('on conflict(project_id, asset_id) do nothing');
    expect(sql).toContain('insert into public.published_assets');
    expect(sql).toContain('publish revision conflict');
    expect(sql).toContain('signed URLs are forbidden in published snapshots');
    expect(sql).toContain('executable content is forbidden in published snapshots');
    expect(sql).toContain("authoritative_digest := encode(public.digest(convert_to(snapshot::text, 'utf8'), 'sha256'), 'hex')");
    expect(sql).toContain('and scene_digest = authoritative_digest');
    expect(sql).toContain('if result.id is not null then');
    expect(sql).toContain('return result;');
  });
});

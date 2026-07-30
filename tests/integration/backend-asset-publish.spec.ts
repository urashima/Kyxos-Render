import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Supabase publish asset ownership', () => {
  it('pins only publisher-owned assets to the project and immutable release', async () => {
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
  });
});

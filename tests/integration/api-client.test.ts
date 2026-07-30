import { describe, expect, it } from 'vitest';
import { createMockApiClient } from '../../packages/api-client/src';

describe('api client mock fallback', () => {
  it('supports project lifecycle and immutable publishing', async () => {
    const client = createMockApiClient({ ownerId: 'tester' });
    const created = await client.createProject('Robot Demo');
    expect(created.ok).toBe(true);
    const project = created.data!;
    const first = await client.publishProject(project.metadata.id, 'unlisted');
    const second = await client.republishProject(project.metadata.id);
    expect(first.data?.revision).toBe(1);
    expect(second.data?.revision).toBe(2);
    expect(first.data?.id).not.toBe(second.data?.id);
    const resolved = await client.resolvePublicScene(second.data!.slug);
    expect(resolved.ok).toBe(true);
    await client.unpublishProject(project.metadata.id);
    expect((await client.resolvePublicScene(second.data!.slug)).code).toBe('KX_PUBLICATION_NOT_FOUND');
  });
});

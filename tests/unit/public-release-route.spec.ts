import { describe, expect, it } from 'vitest';

import { normalizePublishedRoute } from '../../apps/public-viewer/src/release-route-bootstrap';

describe('Public Viewer release routes', () => {
  it('keeps current query links unchanged', () => {
    const url = normalizePublishedRoute(
      new URL('https://example.com/preview/pr-15/public/?release=version-1'),
    );
    expect(url.searchParams.get('release')).toBe('version-1');
  });

  it('normalizes legacy version and hash links', () => {
    expect(
      normalizePublishedRoute(new URL('https://example.com/public/?version=version-2'))
        .searchParams.get('release'),
    ).toBe('version-2');
    expect(
      normalizePublishedRoute(new URL('https://example.com/public/#slug=my-scene'))
        .searchParams.get('slug'),
    ).toBe('my-scene');
  });

  it('normalizes canonical slug, fixed version and embed paths', () => {
    const current = normalizePublishedRoute(
      new URL('https://example.com/s/my-scene'),
    );
    expect(current.searchParams.get('slug')).toBe('my-scene');

    const fixed = normalizePublishedRoute(
      new URL('https://example.com/s/my-scene/v/version-3'),
    );
    expect(fixed.searchParams.get('slug')).toBe('my-scene');
    expect(fixed.searchParams.get('release')).toBe('version-3');

    const embed = normalizePublishedRoute(
      new URL('https://example.com/embed/version-4'),
    );
    expect(embed.searchParams.get('release')).toBe('version-4');
    expect(embed.searchParams.get('ui')).toBe('0');
  });
});

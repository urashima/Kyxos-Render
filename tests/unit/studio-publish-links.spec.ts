import { describe, expect, it } from 'vitest';

import {
  normalizeStudioPublishedUrl,
  studioDeploymentPrefix,
} from '../../apps/studio/src/publish-link-compat';

describe('Studio published links', () => {
  const preview = new URL(
    'https://urashima.github.io/Kyxos-Render/preview/pr-15/studio/',
  );

  it('finds the deployment prefix without hard-coding the PR number', () => {
    expect(studioDeploymentPrefix(preview.pathname)).toBe(
      '/Kyxos-Render/preview/pr-15/',
    );
    expect(studioDeploymentPrefix('/studio/')).toBe('/');
  });

  it('routes release and embed query links to sibling applications', () => {
    expect(
      normalizeStudioPublishedUrl(
        'https://urashima.github.io/public/?release=v1',
        preview,
      ),
    ).toBe(
      'https://urashima.github.io/Kyxos-Render/preview/pr-15/public/?release=v1',
    );
    expect(
      normalizeStudioPublishedUrl(
        'https://urashima.github.io/embed/?release=v2&ui=0',
        preview,
      ),
    ).toBe(
      'https://urashima.github.io/Kyxos-Render/preview/pr-15/embed/?release=v2&ui=0',
    );
  });

  it('converts canonical slug paths into static-host compatible queries', () => {
    expect(
      normalizeStudioPublishedUrl(
        'https://urashima.github.io/s/material-study',
        preview,
      ),
    ).toBe(
      'https://urashima.github.io/Kyxos-Render/preview/pr-15/public/?slug=material-study',
    );
    expect(
      normalizeStudioPublishedUrl(
        'https://urashima.github.io/s/material-study/v/version-3',
        preview,
      ),
    ).toBe(
      'https://urashima.github.io/Kyxos-Render/preview/pr-15/public/?slug=material-study&release=version-3',
    );
  });

  it('leaves external and already deployment-relative links alone', () => {
    expect(
      normalizeStudioPublishedUrl('https://example.com/public/?release=v1', preview),
    ).toBe('https://example.com/public/?release=v1');
    const deployed =
      'https://urashima.github.io/Kyxos-Render/preview/pr-15/public/?release=v1';
    expect(normalizeStudioPublishedUrl(deployed, preview)).toBe(deployed);
  });
});

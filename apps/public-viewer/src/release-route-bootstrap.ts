function decode(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Public Viewer owns its route compatibility. It does not import Studio or
 * Playground code; it only normalizes supported public URL forms before the
 * Public Viewer application reads location.search.
 */
export function normalizePublishedRoute(url: URL): URL {
  const normalized = new URL(url.href);
  if (normalized.searchParams.has('release') || normalized.searchParams.has('slug')) {
    return normalized;
  }

  const legacyVersion = normalized.searchParams.get('version');
  if (legacyVersion) {
    normalized.searchParams.delete('version');
    normalized.searchParams.set('release', legacyVersion);
    return normalized;
  }

  const hash = new URLSearchParams(normalized.hash.replace(/^#/, ''));
  const hashRelease = hash.get('release') ?? hash.get('version');
  const hashSlug = hash.get('slug');
  if (hashRelease || hashSlug) {
    normalized.hash = '';
    if (hashRelease) normalized.searchParams.set('release', hashRelease);
    if (hashSlug) normalized.searchParams.set('slug', hashSlug);
    return normalized;
  }

  const path = normalized.pathname;
  const versionedSlug = path.match(/\/s\/([^/]+)\/v\/([^/]+)\/?$/);
  if (versionedSlug) {
    normalized.searchParams.set('slug', decode(versionedSlug[1])!);
    normalized.searchParams.set('release', decode(versionedSlug[2])!);
    return normalized;
  }

  const slug = path.match(/\/(?:s|view)\/([^/]+)\/?$/);
  if (slug) {
    normalized.searchParams.set('slug', decode(slug[1])!);
    return normalized;
  }

  const embedRelease = path.match(/\/embed\/([^/]+)\/?$/);
  if (embedRelease) {
    normalized.searchParams.set('release', decode(embedRelease[1])!);
    normalized.searchParams.set('ui', '0');
  }
  return normalized;
}

const normalized = normalizePublishedRoute(new URL(location.href));
if (normalized.href !== location.href) {
  history.replaceState(history.state, '', normalized.href);
}

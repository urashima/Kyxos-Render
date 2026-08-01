function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function studioDeploymentPrefix(pathname: string): string | null {
  const marker = '/studio/';
  const index = pathname.lastIndexOf(marker);
  return index >= 0 ? pathname.slice(0, index + 1) : null;
}

/**
 * Converts production-root links emitted by the legacy Studio release dialog
 * into deployment-relative Public Viewer and Embed links. This keeps the apps
 * independent while supporting GitHub Pages paths such as /preview/pr-15/.
 */
export function normalizeStudioPublishedUrl(
  value: string,
  current = new URL(location.href),
): string {
  let target: URL;
  try {
    target = new URL(value, current);
  } catch {
    return value;
  }

  if (target.origin !== current.origin) return value;
  const prefix = studioDeploymentPrefix(current.pathname);
  if (!prefix) return value;

  if (target.pathname === '/public/' || target.pathname === '/public') {
    target.pathname = `${prefix}public/`;
    return target.href;
  }

  if (target.pathname === '/embed/' || target.pathname === '/embed') {
    target.pathname = `${prefix}embed/`;
    return target.href;
  }

  const fixedVersion = target.pathname.match(/^\/s\/([^/]+)\/v\/([^/]+)\/?$/);
  if (fixedVersion) {
    target.pathname = `${prefix}public/`;
    target.search = '';
    target.searchParams.set('slug', safeDecode(fixedVersion[1]));
    target.searchParams.set('release', safeDecode(fixedVersion[2]));
    return target.href;
  }

  const currentSlug = target.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (currentSlug) {
    target.pathname = `${prefix}public/`;
    target.search = '';
    target.searchParams.set('slug', safeDecode(currentSlug[1]));
    return target.href;
  }

  return value;
}

function installPublishedLinkCompatibility(): void {
  const nativeOpen = window.open.bind(window);
  window.open = ((
    url?: string | URL,
    target?: string,
    features?: string,
  ): WindowProxy | null => {
    const routed =
      typeof url === 'string'
        ? normalizeStudioPublishedUrl(url)
        : url instanceof URL
          ? normalizeStudioPublishedUrl(url.href)
          : url;
    return nativeOpen(routed, target, features);
  }) as typeof window.open;

  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return;
  const nativeWriteText = clipboard.writeText.bind(clipboard);
  try {
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      value: (text: string) => nativeWriteText(normalizeStudioPublishedUrl(text)),
    });
  } catch {
    // Some browsers expose Clipboard methods as non-configurable. Opening the
    // published page is still corrected; copy behavior remains native there.
  }
}

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  installPublishedLinkCompatibility();
}

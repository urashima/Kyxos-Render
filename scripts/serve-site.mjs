import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createServer } from 'node:http';

const root = resolve('site');
const port = Number(process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
};
const legacyRoutes = new Set([
  'overview', 'pbr', 'buffers', 'aa', 'traa', 'temporal', 'gtao', 'ssao', 'ssr', 'ssgi',
  'motion-blur', 'denoise', 'sharpness', 'lens-distortion', 'background', 'sparkle',
  'full-stack', 'performance', 'lifecycle',
]);

async function resolveFile(pathname) {
  let safePath = decodeURIComponent(pathname).replace(/\\/g, '/');
  if (safePath.includes('..')) return null;
  const first = safePath.split('/').filter(Boolean)[0];
  if (legacyRoutes.has(first)) safePath = `/latest${safePath}`;
  if (safePath === '/') safePath = '/latest/index.html';
  let path = resolve(root, `.${safePath}`);
  if (!path.startsWith(root)) return null;
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = resolve(path, 'index.html');
    await stat(path);
    return path;
  } catch {
    const section = safePath.split('/').filter(Boolean)[0];
    if (['latest', 'studio', 'public', 'embed'].includes(section)) {
      const fallback = resolve(root, section, 'index.html');
      try { await stat(fallback); return fallback } catch { return null }
    }
    return null;
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = await resolveFile(url.pathname);
  if (!path) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': types[extname(path)] ?? 'application/octet-stream',
    'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'cross-origin-resource-policy': 'cross-origin',
  });
  createReadStream(path).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Kyxos acceptance site: http://127.0.0.1:${port}`));

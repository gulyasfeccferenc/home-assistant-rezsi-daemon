import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Client-side routes that may appear as a path (deep links from notifications). */
const SPA_ROUTE = /^\/(attekintes|rogzites|tablazat|grafikonok|beallitasok)(\/[\w-]*)*\/?$/;

/**
 * The Ingress gateway strips its prefix, so the app is always served from `/` but the browser sees
 * `/api/hassio_ingress/<token>/`. A `<base>` element pointing at that prefix (from X-Ingress-Path)
 * keeps relative asset and API URLs working even when a deep link path is opened.
 */
export function injectBase(html: string, ingressPath: string | undefined): string {
  const base = (ingressPath ?? '').replace(/\/+$/, '') + '/';
  const safe = base.replace(/[^\w\-./]/g, '');
  return html.replace('<head>', `<head>\n    <base href="${safe}" />`);
}

export function createStaticHandler(webDir: string) {
  let indexCache: string | undefined;
  const root = normalize(webDir + sep);

  async function index(c: Context) {
    indexCache ??= await readFile(join(webDir, 'index.html'), 'utf8');
    c.header('Cache-Control', 'no-cache');
    return c.html(injectBase(indexCache, c.req.header('X-Ingress-Path')));
  }

  return async (c: Context) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (path === '/' || path === '/index.html' || SPA_ROUTE.test(path)) {
      try {
        return await index(c);
      } catch {
        return c.text('A felület nincs lefordítva (web/dist hiányzik).', 503);
      }
    }
    const file = normalize(join(webDir, path));
    if (!file.startsWith(root)) return c.notFound();
    try {
      const body = await readFile(file);
      c.header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      // Vite emits content-hashed file names under assets/.
      c.header('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(body);
    } catch {
      return c.notFound();
    }
  };
}

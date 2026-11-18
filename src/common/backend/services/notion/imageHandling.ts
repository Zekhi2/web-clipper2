/**
 * Image handling for the Notion backend.
 *
 * Notion serves external images through its own server-side proxy, so an
 * image only displays when Notion's servers can fetch it. CDNs with
 * anti-bot/hotlink protection (zhihu's pic*.zhimg.com returns 567 for
 * non-browser user agents, for example) block that server-side fetch while
 * the same URL loads fine in a browser — so probing with the browser's own
 * identity would wrongly classify blocked images as accessible.
 *
 * To match Notion's situation, probes are performed with the User-Agent
 * header rewritten to a non-browser value (via the extension's
 * declarativeNetRequest machinery, see
 * `service/webRequest/browser/background/tabService.ts`). An image is kept
 * as an external link only when that server-identity fetch succeeds; the
 * browser identity is used afterwards for actually obtaining the bytes when
 * rehosting, since the user can always download what they can see.
 *
 * Three user-facing behaviours build on the helpers here:
 * - probe: decide per image whether Notion can load the original URL;
 * - rehost through the user's configured image host;
 * - rehost through Notion's own File Upload API (client-side download + direct
 *   upload, then patching the created image blocks).
 */

/** User-Agent sent for accessibility probes. Deliberately non-browser: the
 * probe must reproduce what Notion's server-side fetcher looks like to the
 * origin CDN, not what the user's browser looks like. When a CDN rejects
 * this identity we fail safe and rehost, so a false "blocked" only costs an
 * unnecessary rehost while a false "accessible" costs a broken image. */
export const SERVER_FETCH_USER_AGENT = 'NotionClipper/1.0';

/** Unique http(s) image URLs in a markdown document, in first-appearance
 * order. Data URIs are ignored. */
export const extractImageUrls = (markdown: string): string[] => {
  const urls: string[] = [];
  for (const match of (markdown || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    const url = match[1];
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
};

/** Rewrite `![alt](old)` occurrences to `![alt](new)` for each mapping entry. */
export const replaceImageUrls = (markdown: string, mapping: Map<string, string>): string => {
  let result = markdown || '';
  mapping.forEach((newUrl, oldUrl) => {
    const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(!\\[[^\\]]*\\])\\(${escaped}\\)`, 'g'), `$1(${newUrl})`);
  });
  return result;
};

export type ImageDownloader = (url: string) => Promise<Blob>;

/** An image is considered Notion-accessible when it downloads as image
 * content without special headers. Anything else (HTTP error, anti-bot HTML
 * page, network failure) is treated as blocked — failing safe means the image
 * gets rehosted instead of silently broken. */
export const isImageBlobAccessible = (blob?: Blob | null): boolean =>
  !!blob && typeof blob.type === 'string' && blob.type.toLowerCase().startsWith('image/');

/** Classify every URL. Results arrive in parallel; one failing URL never
 * affects the others. Every download is performed through `download`, which
 * must present a server-side identity (see `SERVER_FETCH_USER_AGENT`). */
export const probeImageAccessibility = async (
  urls: string[],
  download: ImageDownloader,
  concurrency = 6
): Promise<Map<string, boolean>> => {
  const results = new Map<string, boolean>();
  const queue = [...urls];
  const workers = Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) {
        return;
      }
      try {
        const blob = await download(url);
        results.set(url, isImageBlobAccessible(blob));
      } catch {
        results.set(url, false);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

const EXTENSIONS_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export const extensionForContentType = (contentType: string): string => {
  const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS_BY_CONTENT_TYPE[normalized] || 'jpg';
};

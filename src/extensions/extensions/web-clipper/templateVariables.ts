import dayjs from 'dayjs';
import { CATEGORY_ARTICLE, CATEGORY_VIDEO } from '@/common/clipCategory';

/**
 * Page-derived variables for the template feature. Keys are the placeholder
 * names usable in templates, e.g. `{AUTHOR}`.
 */
export interface TemplateVariables {
  [key: string]: string;
  /** Detected clip type: 🎬 Video, 📄 Article, or 🔖 Bookmark. */
  CATEGORY: string;
}

const metaContent = (document: Document, selector: string): string => {
  const element = document.querySelector(selector);
  const content = element?.getAttribute('content');
  return content ? content.trim() : '';
};

const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * Many sites — especially Chinese news portals — append the site name to the
 * page title: `Article title - Site Name`. When neither meta tags nor JSON-LD
 * declare a site name, the last short segment after a common separator is a
 * reasonable guess. The segment must be short and not numeric, so titles like
 * `Report 2023-02-27` do not yield `27`.
 */
const SITE_TITLE_SEPARATOR = /\s*[|\-·—–_]\s*/;

const MAX_SITE_NAME_LENGTH = 20;

const isPlausibleSiteName = (candidate: string): boolean =>
  candidate.length > 0 && candidate.length <= MAX_SITE_NAME_LENGTH && !/^[\d.,:/ ]+$/.test(candidate);

const splitTitleSegments = (title: string): string[] =>
  (title || '').split(SITE_TITLE_SEPARATOR).filter(segment => segment.length > 0);

/** Site name guessed from the title tail: `Article - Site Name`. */
const getSiteFromTitle = (title: string): string => {
  const segments = splitTitleSegments(title);
  if (segments.length < 2) {
    return '';
  }
  const tail = segments[segments.length - 1];
  return isPlausibleSiteName(tail) ? tail : '';
};

/**
 * Fallback for sites that put the site name first: `Site Name | Section |
 * Long article title...` (any number of segments). Only used when the suffix
 * guess failed — i.e. the tail is too long to be a site name — which keeps
 * `Article - Section - Site` titles from being hijacked. The candidate must
 * not end in a digit, so report titles like `Report 2023 - long article...`
 * do not yield `Report 2023`.
 */
const getSiteFromTitlePrefix = (title: string): string => {
  const segments = splitTitleSegments(title);
  if (segments.length < 2) {
    return '';
  }
  const head = segments[0];
  return isPlausibleSiteName(head) && !/\d$/.test(head) ? head : '';
};

/**
 * Web App Manifest (`<link rel="manifest">`) names are an increasingly common
 * site declaration. The manifest may be cross-origin and is fetched
 * asynchronously; every failure is swallowed — the manifest is only one of
 * many fallbacks.
 */
const getSiteFromManifest = async (document: Document): Promise<string> => {
  const link = document.querySelector('link[rel~="manifest"]');
  const href = link?.getAttribute('href');
  if (!href) {
    return '';
  }
  try {
    const url = new URL(href, document.baseURI || document.URL);
    const response = await fetch(url.href);
    if (!response.ok) {
      return '';
    }
    const manifest = await response.json();
    if (typeof manifest?.name === 'string' && manifest.name.trim()) {
      return manifest.name.trim();
    }
    if (typeof manifest?.short_name === 'string' && manifest.short_name.trim()) {
      return manifest.short_name.trim();
    }
  } catch {
    // Unreachable manifest, CORS rejection or invalid JSON: just fall through.
  }
  return '';
};

const timeContent = (document: Document): string => {
  const element = document.querySelector('time[datetime]');
  const datetime = element?.getAttribute('datetime');
  return datetime ? datetime.trim() : '';
};

const isValidDateParts = (year: number, month: number, day: number): boolean => {
  if (year < 1990 || year > new Date().getFullYear() + 1) {
    return false;
  }
  const asUtcDate = new Date(Date.UTC(year, month - 1, day));
  return asUtcDate.getUTCMonth() === month - 1 && asUtcDate.getUTCDate() === day;
};

/** URL path patterns that embed the publish date, common across news CMSes. */
const URL_DATE_PATTERNS = [
  // /2023/02/27/, 2023-02-27 (also single-digit month/day)
  /(?:^|[\W_])(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})(?:$|[\W_])/,
  // 20230227, optionally preceded by a CMS marker such as `t20230227_`
  /(?:^|[\W_])t?(\d{4})(\d{2})(\d{2})(?:$|[\W_])/,
];

/**
 * Infers the publish date from the article URL. CMSes bake the date into the
 * URL slug when the article is first published and never rewrite it when the
 * page is later regenerated, so it is often more faithful than metadata the
 * CMS may restamp on update. Returns `YYYY-MM-DD` or ''.
 */
export const getPublishedFromUrl = (url: string): string => {
  try {
    const path = new URL(url).pathname;
    for (const pattern of URL_DATE_PATTERNS) {
      const match = pattern.exec(path);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        if (isValidDateParts(year, month, day)) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
  } catch {
    // Not a parseable URL.
  }
  return '';
};

/**
 * Decides between a declared publish date and the URL-inferred date. Declared
 * metadata wins unless the two conflict on the year — e.g. a CMS restamps
 * `pubDate` when it regenerates a page — in which case the URL date (frozen at
 * publish time) is more trustworthy. Keeps the declared value when the years
 * agree so that its time-of-day is preserved.
 */
const resolvePublished = (declared: string, urlDate: string): string => {
  if (!declared) {
    return urlDate;
  }
  if (!urlDate) {
    return declared;
  }
  const declaredYear = parseInt(declared.slice(0, 4), 10);
  const urlYear = parseInt(urlDate.slice(0, 4), 10);
  if (declaredYear && urlYear && declaredYear !== urlYear) {
    return urlDate;
  }
  return declared;
};

/**
 * Extract a top-level property from the page's JSON-LD (schema.org) data.
 * Handles arrays of items, `@graph` containers and object/array values like
 * `author: { name: '...' }` or `author: [{ name: '...' }, { name: '...' }]`.
 */
const getJsonLdValue = (document: Document, key: string): string => {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const parsed = JSON.parse(scripts[i].textContent || '');
      const items: any[] = Array.isArray(parsed)
        ? parsed
        : [parsed, ...((parsed['@graph'] as any[]) || [])];
      for (const item of items) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const value = item[key];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
        if (Array.isArray(value)) {
          const names = value
            .map(entry => (typeof entry === 'string' ? entry : entry?.name))
            .filter(name => name && typeof name === 'string')
            .map(name => name.trim());
          if (names.length) {
            return names.join(', ');
          }
        } else if (value && typeof value.name === 'string' && value.name.trim()) {
          return value.name.trim();
        }
      }
    } catch {
      // Ignore invalid JSON-LD scripts.
    }
  }
  return '';
};

const VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'bilibili.com',
  'v.qq.com',
  'vimeo.com',
  'youku.com',
  'ixigua.com',
  'douyin.com',
  'ted.com',
  'twitch.tv',
  'dailymotion.com',
];

const isVideoHostUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return VIDEO_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    // Not a parseable URL.
    return false;
  }
};

/** Top-level `@type` values from the page's JSON-LD (schema.org) data,
 * space-joined so regexes can test several of them at once. */
const getJsonLdType = (document: Document): string => {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const types: string[] = [];
  for (let i = 0; i < scripts.length; i++) {
    try {
      const parsed = JSON.parse(scripts[i].textContent || '');
      const items: any[] = Array.isArray(parsed)
        ? parsed
        : [parsed, ...((parsed['@graph'] as any[]) || [])];
      for (const item of items) {
        const value = item?.['@type'];
        if (typeof value === 'string' && value.trim()) {
          types.push(value.trim());
        } else if (Array.isArray(value)) {
          types.push(...value.filter((entry: any) => typeof entry === 'string'));
        }
      }
    } catch {
      // Ignore invalid JSON-LD scripts.
    }
  }
  return types.join(' ');
};

const ARTICLE_JSON_LD_TYPES = /\b(article|blogposting|newsarticle|webpage|webcontent)\b/i;
const VIDEO_JSON_LD_TYPES = /\b(videoobject|movie)\b/i;

/**
 * Best-effort clip type detection from the page itself. Video needs explicit
 * signals (og:video metadata, a JSON-LD VideoObject, a known video host, or a
 * `<video>` element); an article declaration beats those, so pages that
 * merely embed a video are not misclassified.
 */
export const detectClipCategory = (document: Document): string => {
  const ogType = metaContent(document, 'meta[property="og:type" i]').toLowerCase();
  const hasOgVideo = !!document.querySelector(
    'meta[property="og:video" i], meta[property="og:video:url" i], meta[property="og:video:secure_url" i]'
  );
  const jsonLdType = getJsonLdType(document);
  const isArticle = ogType === 'article' || ARTICLE_JSON_LD_TYPES.test(jsonLdType);
  const isVideo =
    ogType.startsWith('video') ||
    hasOgVideo ||
    VIDEO_JSON_LD_TYPES.test(jsonLdType) ||
    isVideoHostUrl(document.URL) ||
    !!document.querySelector('video');
  if (isVideo && !isArticle) {
    return CATEGORY_VIDEO;
  }
  return CATEGORY_ARTICLE;
};

export const extractTemplateVariables = (document: Document): TemplateVariables => {
  return {
    TITLE: document.title || '',
    URL: document.URL || '',
    AUTHOR:
      metaContent(document, 'meta[name="author" i]') ||
      metaContent(document, 'meta[property="article:author" i]') ||
      getJsonLdValue(document, 'author'),
    DESCRIPTION:
      metaContent(document, 'meta[name="description" i]') ||
      metaContent(document, 'meta[property="og:description" i]'),
    PUBLISHED: resolvePublished(
      metaContent(document, 'meta[property="article:published_time" i]') ||
        getJsonLdValue(document, 'datePublished') ||
        getJsonLdValue(document, 'pubDate') ||
        timeContent(document),
      getPublishedFromUrl(document.URL)
    ),
    UPDATED:
      metaContent(document, 'meta[property="article:modified_time" i]') ||
      getJsonLdValue(document, 'dateModified') ||
      getJsonLdValue(document, 'upDate'),
    SITE:
      metaContent(document, 'meta[property="og:site_name" i]') ||
      metaContent(document, 'meta[name="application-name" i]') ||
      metaContent(document, 'meta[name="apple-mobile-web-app-title" i]') ||
      getJsonLdValue(document, 'publisher') ||
      getSiteFromTitle(document.title) ||
      getSiteFromTitlePrefix(document.title),
    DOMAIN: getDomain(document.URL),
    IMAGE:
      metaContent(document, 'meta[property="og:image" i]') ||
      metaContent(document, 'meta[name="twitter:image" i]'),
    CATEGORY: detectClipCategory(document),
  };
};

/**
 * Same as `extractTemplateVariables`, but additionally fetches the Web App
 * Manifest for the site name when no cheaper signal produced one.
 */
export const extractTemplateVariablesAsync = async (
  document: Document
): Promise<TemplateVariables> => {
  const variables = extractTemplateVariables(document);
  if (!variables.SITE) {
    variables.SITE = await getSiteFromManifest(document);
  }
  return variables;
};

/**
 * Counts "words" in a Markdown document: whitespace-delimited tokens for
 * latin scripts, one word per character for CJK scripts.
 */
export const countWords = (content: string): number => {
  if (!content) {
    return 0;
  }
  const matches = content.match(/[A-Za-z0-9_']+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  return matches ? matches.length : 0;
};

const HANZI_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const LATIN_TOKEN_PATTERN = /[A-Za-z0-9_']+/g;

/** Counts Han characters only (Chinese text, excluding CJK punctuation). */
export const countHanzi = (content: string): number => {
  if (!content) {
    return 0;
  }
  const matches = content.match(HANZI_PATTERN);
  return matches ? matches.length : 0;
};

/**
 * Counts latin "words": runs of ASCII letters, digits, underscores and
 * apostrophes, e.g. `Hello`, `foo_bar`, `2026` and `don't` are one each.
 */
export const countEnglishWords = (content: string): number => {
  if (!content) {
    return 0;
  }
  const matches = content.match(LATIN_TOKEN_PATTERN);
  return matches ? matches.length : 0;
};

/**
 * Counts paragraphs: non-empty blocks separated by blank lines. Each fenced
 * code block counts as one paragraph, and blank lines inside code blocks do
 * not split it.
 */
export const countParagraphs = (content: string): number => {
  if (!content) {
    return 0;
  }
  const placeholder = '\ncodeblock\n';
  const withoutCodeBlocks = content
    .replace(/```[\s\S]*?```/g, placeholder)
    .replace(/~~~[\s\S]*~~~/g, placeholder);
  return withoutCodeBlocks
    .split(/\r?\n\s*\r?\n/)
    .filter(block => block.trim().length > 0).length;
};

/** Counts non-whitespace characters, including Markdown syntax characters. */
export const countChars = (content: string): number => {
  if (!content) {
    return 0;
  }
  return content.replace(/\s/g, '').length;
};

/** Current date, e.g. 2026-11-16. */
export const getDate = (): string => dayjs().format('YYYY-MM-DD');

/** Current date and time, e.g. 2026-11-16 15:30:45. */
export const getTime = (): string => dayjs().format('YYYY-MM-DD HH:mm:ss');

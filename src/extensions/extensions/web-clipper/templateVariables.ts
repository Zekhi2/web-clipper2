import dayjs from 'dayjs';

/**
 * Page-derived variables for the template feature. Keys are the placeholder
 * names usable in templates, e.g. `{AUTHOR}`.
 */
export interface TemplateVariables {
  [key: string]: string;
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
const SITE_FROM_TITLE_PATTERN = /[|\-·—–_]\s*([^|\-·—–_]{1,12})\s*$/;

const getSiteFromTitle = (title: string): string => {
  const match = SITE_FROM_TITLE_PATTERN.exec(title || '');
  const candidate = match?.[1]?.trim();
  if (!candidate || /^[\d.,:/ ]+$/.test(candidate)) {
    return '';
  }
  return candidate;
};

const timeContent = (document: Document): string => {
  const element = document.querySelector('time[datetime]');
  const datetime = element?.getAttribute('datetime');
  return datetime ? datetime.trim() : '';
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
    PUBLISHED:
      metaContent(document, 'meta[property="article:published_time" i]') ||
      getJsonLdValue(document, 'datePublished') ||
      getJsonLdValue(document, 'pubDate') ||
      timeContent(document),
    SITE:
      metaContent(document, 'meta[property="og:site_name" i]') ||
      metaContent(document, 'meta[name="application-name" i]') ||
      getJsonLdValue(document, 'publisher') ||
      getSiteFromTitle(document.title),
    DOMAIN: getDomain(document.URL),
    IMAGE:
      metaContent(document, 'meta[property="og:image" i]') ||
      metaContent(document, 'meta[name="twitter:image" i]'),
  };
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

/**
 * Helpers for the Web Clipper frontmatter template:
 *
 * ```
 * ---
 * clipped: 2026-11-17
 * source: www.ruanyifeng.com
 * tags: WebClipper
 * ---
 * # Article title
 * ...
 * ```
 *
 * Notion's Markdown API has no frontmatter support, so we parse it here and
 * turn it into native Notion properties (database parents) or a callout block
 * (plain page parents).
 */

export interface ParsedClip {
  /** Flat key → value map. Keys keep their original casing. */
  meta: Record<string, string>;
  /** Content with the frontmatter block (and a duplicate H1) removed. */
  body: string;
}

const FRONTMATTER_DELIMITER = /^---\s*$/;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
};

const parseScalar = (value: string): string => {
  const trimmed = unquote(value);
  // `[a, b]` style lists
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

/** Parse a leading YAML-ish frontmatter block. Only flat `key: value` pairs
 * (plus `- item` lists under an empty key) are supported — that is all the
 * clipper template produces. */
export const parseFrontmatter = (content: string): ParsedClip => {
  const source = (content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  if (!FRONTMATTER_DELIMITER.test(lines[0] || '')) {
    return { meta: {}, body: source };
  }

  const meta: Record<string, string> = {};
  let end = -1;
  let currentKey = '';
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_DELIMITER.test(lines[i])) {
      end = i;
      break;
    }
    const line = lines[i];
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const item = parseScalar(listItem[1]);
      if (item) {
        meta[currentKey] = meta[currentKey] ? `${meta[currentKey]}, ${item}` : item;
      }
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }
    const value = parseScalar(line.slice(separator + 1));
    meta[key] = value;
    currentKey = key;
  }

  if (end < 0) {
    // No closing delimiter — this is ordinary Markdown starting with a rule.
    return { meta: {}, body: source };
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\s*\n/, '');
  return { meta, body };
};

const normalizeForComparison = (value: string): string =>
  value.replace(/[\s\-—–_·|,，。:：（）()【】\[\]!！?？]/g, '').toLowerCase();

/**
 * The clipper template puts the article title in an H1 again. When we have
 * frontmatter we know the content came from that template, so drop the H1 if
 * it matches (or is a prefix/suffix of) the page title.
 */
export const stripDuplicateHeading = (body: string, title: string): string => {
  const match = /^\s*#\s+([^\n]+)\n?/.exec(body);
  if (!match) {
    return body;
  }
  const heading = match[1].trim();
  const normalizedHeading = normalizeForComparison(heading);
  const normalizedTitle = normalizeForComparison(title || '');
  // Guard against nuking a short, unrelated heading.
  if (normalizedHeading.length < 8 || !normalizedTitle) {
    return body;
  }
  const duplicate =
    normalizedHeading === normalizedTitle ||
    normalizedTitle.includes(normalizedHeading) ||
    normalizedHeading.includes(normalizedTitle);
  if (!duplicate) {
    return body;
  }
  return body.slice(match[0].length).replace(/^\s*\n/, '');
};

const LABELS: Record<string, string> = {
  clipped: '剪辑时间',
  source: '来源',
  author: '作者',
  published: '发布时间',
  updated: '更新时间',
  tags: '标签',
  category: '类型',
};

const labelFor = (key: string): string => LABELS[key.toLowerCase()] || key;

const asAbsoluteUrl = (value: string): string => {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return '';
};

/** Render metadata as a Notion v2 callout for plain page parents, where no
 * native properties are available. */
export const buildCallout = (meta: Record<string, string>): string => {
  const lines: string[] = [];
  Object.keys(meta).forEach((key) => {
    const value = (meta[key] || '').trim();
    if (!value) {
      return;
    }
    const url = asAbsoluteUrl(value);
    lines.push(url ? `${labelFor(key)}: [${value}](${url})` : `${labelFor(key)}: ${value}`);
  });
  if (lines.length === 0) {
    return '';
  }
  return `<callout icon="📎">\n${lines.join('\n')}\n</callout>`;
};

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_WRAPPED_IMAGE = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g;
const IMAGE_ONLY_LINE = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/;
const LIST_OR_QUOTE_MARKER = /^\s*(?:>|[-*+]|\d+[.)])\s+/;

/**
 * Notion's Markdown parser rejects images that are not standalone blocks:
 * an image inside paragraph text, inside a list item, inside a table cell or
 * wrapped in a link is a hard parse error (the whole request fails with 400),
 * while Obsidian renders all of these fine. Normalize before sending content
 * to Notion:
 *
 * - link-wrapped images `[![alt](src)](href)` are unwrapped;
 * - images inside paragraph text are split into their own blocks;
 * - images that held a list item (or quote line) alone are pulled out of the
 *   list, dropping the dangling marker;
 * - images inside table cells (which only allow inline content) degrade to
 *   plain links;
 * - fenced code blocks are left untouched.
 */
export const normalizeImageBlocks = (markdown: string): string => {
  const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let inCodeFence = false;

  lines.forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      blocks.push(line);
      return;
    }
    if (inCodeFence) {
      blocks.push(line);
      return;
    }

    // Table cells are inline-only: an image there is a parse error, keep a
    // plain link instead.
    if (/^\s*\|/.test(line)) {
      blocks.push(
        line.replace(LINK_WRAPPED_IMAGE, '[$1]($2)').replace(IMAGE_MARKDOWN, '[$1]($2)')
      );
      return;
    }

    // Unwrap link-wrapped images so the plain image rules below see them.
    const unwrapped = line.replace(LINK_WRAPPED_IMAGE, (_match, alt: string, src: string) => {
      return `![${alt}](${src})`;
    });
    if (!IMAGE_MARKDOWN.test(unwrapped)) {
      IMAGE_MARKDOWN.lastIndex = 0;
      blocks.push(unwrapped);
      return;
    }
    IMAGE_MARKDOWN.lastIndex = 0;

    const marker = LIST_OR_QUOTE_MARKER.exec(unwrapped)?.[0] || '';
    const body = marker ? unwrapped.slice(marker.length) : unwrapped;

    const segments: string[] = [];
    let cursor = 0;
    for (const match of body.matchAll(IMAGE_MARKDOWN)) {
      const text = body.slice(cursor, match.index).trim();
      if (text) {
        segments.push(text);
      }
      segments.push(match[0]);
      cursor = match.index + match[0].length;
    }
    const tail = body.slice(cursor).trim();
    if (tail) {
      segments.push(tail);
    }

    // Keep the list/quote marker attached to the first non-image segment so
    // following list items still connect; when the marker held nothing but an
    // image, the dangling marker is dropped.
    if (marker) {
      const firstText = segments.findIndex((segment) => !IMAGE_ONLY_LINE.test(segment));
      if (firstText >= 0) {
        segments[firstText] = `${marker}${segments[firstText]}`;
      }
    }
    blocks.push(...segments);
  });

  // Images must be surrounded by blank lines, even when they were consecutive.
  const result: string[] = [];
  blocks.forEach((line, index) => {
    if (IMAGE_ONLY_LINE.test(line)) {
      if (result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
      }
      result.push(line);
      const next = blocks[index + 1];
      if (next && next.trim() !== '') {
        result.push('');
      }
    } else {
      result.push(line);
    }
  });
  return result.join('\n');
};

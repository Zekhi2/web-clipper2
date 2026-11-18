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

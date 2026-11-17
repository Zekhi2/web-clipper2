/**
 * Obsidian note titles come from web page titles, which routinely contain
 * characters that Windows (and Obsidian itself) do not accept in file names:
 *
 * - Windows forbids \ / : * ? " < > | plus control characters, names ending
 *   with a dot or space, and reserved device names (CON, PRN, NUL, COM1-9, ...).
 * - Obsidian additionally discourages [ ] # ^ because they collide with
 *   wikilink syntax ([[name#heading]], [[name|alias]], [[name^block]]).
 *
 * `obsidian://new` does not reliably sanitize titles, so we do it here.
 * The default mode maps forbidden characters to their fullwidth equivalents
 * (＼／：＊？＂＜＞｜), which keeps the title readable — a popular approach
 * in the Obsidian community. Two alternative modes are available:
 * `underscore` replaces the characters with `_`, and `off` keeps the raw title.
 */
export type FilenameSanitizeMode = 'fullwidth' | 'underscore' | 'off';

const FALLBACK_TITLE = 'Untitled';

const MAX_FILENAME_LENGTH = 250;

/** Characters forbidden by Windows and/or by Obsidian's wikilink syntax. */
const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/g;

const FULLWIDTH_MAP: Record<string, string> = {
  '\\': '＼',
  '/': '／',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
  '#': '＃',
  '^': '＾',
  '[': '［',
  ']': '］',
};

/** Reserved Windows device names, optionally with an extension. */
const RESERVED_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(\..*)?$/i;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function sanitizeFilename(title: string, mode: FilenameSanitizeMode = 'fullwidth'): string {
  if (!title || !title.trim()) {
    return FALLBACK_TITLE;
  }
  // Control characters are never legitimate in a file name.
  let result = title.replace(CONTROL_CHARS, ' ');
  if (mode === 'fullwidth') {
    result = result.replace(FORBIDDEN_CHARS, ch => FULLWIDTH_MAP[ch]);
  } else if (mode === 'underscore') {
    result = result.replace(FORBIDDEN_CHARS, '_');
  }
  // Obsidian forbids leading dots; Windows forbids trailing dots and spaces.
  result = result.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (RESERVED_DEVICE_NAME.test(result)) {
    result = `${result}_`;
  }
  if (!result) {
    return FALLBACK_TITLE;
  }
  if (result.length > MAX_FILENAME_LENGTH) {
    result = result.slice(0, MAX_FILENAME_LENGTH).replace(/[.\s]+$/, '');
  }
  return result;
}

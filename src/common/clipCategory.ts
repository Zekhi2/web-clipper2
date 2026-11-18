/**
 * Clip category labels shared by the template layer (which can inspect the
 * page DOM) and the Notion backend (which only sees the final Markdown).
 * The video/article labels deliberately carry the same emoji style as the
 * "Web Clips and Bookmarks Manager" template's Category options so new
 * options blend in with the existing ones.
 */
export const CATEGORY_VIDEO = '🎬 Video';
export const CATEGORY_ARTICLE = '📄 Article';
export const CATEGORY_BOOKMARK = '🔖 Bookmark';

/**
 * The built-in Bookmark tool produces a tiny link-only document:
 *
 * ```
 * ## Link
 * [URL](URL)
 * ## Comment:
 * ```
 *
 * Anything short that carries that heading marker is a bookmark rather than
 * an article. Longer documents only containing an unrelated "Link" heading
 * are not bookmarks.
 */
export const isBookmarkStub = (content: string): boolean => {
  const trimmed = (content || '').trim();
  if (!trimmed || trimmed.length > 300) {
    return false;
  }
  return /(^|\n)#{1,6}\s*(链接|Link)\s*(\n|$)/.test(trimmed);
};

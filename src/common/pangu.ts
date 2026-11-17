import remark from 'remark';
import remakPangu from '@web-clipper/remark-pangu';

/**
 * Matches a YAML frontmatter block at the very beginning of a document:
 * an opening --- line, followed (somewhere later) by a closing --- line,
 * optionally followed by a newline (which is consumed as part of the block).
 */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/**
 * Runs pangu (Chinese/English spacing) over a markdown document with remark.
 *
 * remark re-serializes the whole document and normalizes markdown syntax
 * (thematic breaks become `* * *`, setext headings become ATX headings, bare
 * URLs become links). That is harmless for ordinary content but destroys a
 * leading frontmatter block, which is data rather than prose. The frontmatter
 * is therefore split off and passed through untouched.
 */
export async function processPanguWithRemark(document: string): Promise<string> {
  const frontmatter = FRONTMATTER_PATTERN.exec(document);
  if (!frontmatter) {
    const result = await remark()
      .use(remakPangu)
      .process(document);
    return result.contents as string;
  }
  const body = document.slice(frontmatter[0].length);
  if (!body.trim()) {
    return frontmatter[0] + body;
  }
  const result = await remark()
    .use(remakPangu)
    .process(body);
  return frontmatter[0] + (result.contents as string);
}

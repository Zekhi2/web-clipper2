import { describe, it, expect } from 'vitest';
import { processPanguWithRemark } from './pangu';

const frontmatterTemplate = [
  '---',
  'created: 2026-11-16',
  'source: https://example.com/article',
  'author: ',
  'tags: webclip',
  '---',
  '# 中文标题English混排',
  '',
  '> 来源:示例站点(example.com) · 123 字',
  '',
  '这是正文English内容。',
  '',
].join('\n');

describe('processPanguWithRemark', () => {
  it('preserves a leading frontmatter block verbatim', async () => {
    const result = await processPanguWithRemark(frontmatterTemplate);
    expect(result.startsWith('---\ncreated: 2026-11-16\nsource: https://example.com/article\nauthor: \ntags: webclip\n---\n')).toBe(
      true
    );
  });

  it('still processes the document body after the frontmatter', async () => {
    const result = await processPanguWithRemark(frontmatterTemplate);
    expect(result).toContain('# 中文标题 English 混排');
    expect(result).toContain('这是正文 English 内容。');
  });

  it('normalizes markdown inside the body without touching the frontmatter', async () => {
    const result = await processPanguWithRemark(frontmatterTemplate);
    // the frontmatter `---` lines must survive remark's thematic break normalization
    expect(result.split('\n')[0]).toBe('---');
  });

  it('processes documents without frontmatter as before', async () => {
    const result = await processPanguWithRemark('中文English混排文本。');
    expect(result).toContain('中文 English 混排文本。');
  });

  it('treats a thematic break at the start without a closing fence as normal content', async () => {
    const result = await processPanguWithRemark('---\n\n中文English。');
    expect(result).not.toContain('---\n\n中文');
  });

  it('handles frontmatter closed at end of file without a trailing newline', async () => {
    const result = await processPanguWithRemark('---\ncreated: 2026-11-16\n---');
    expect(result).toBe('---\ncreated: 2026-11-16\n---');
  });
});

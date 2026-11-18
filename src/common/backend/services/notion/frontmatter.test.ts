import { describe, test, expect } from 'vitest';
import {
  buildCallout,
  normalizeImageBlocks,
  parseFrontmatter,
  stripDuplicateHeading,
} from './frontmatter';

describe('frontmatter helpers', () => {
  test('parses flat key/value frontmatter and removes it from the body', () => {
    const parsed = parseFrontmatter(
      '---\nclipped: 2026-11-17\nsource: www.ruanyifeng.com\ntags: WebClipper\n---\n# Title\nBody'
    );
    expect(parsed.meta).toEqual({
      clipped: '2026-11-17',
      source: 'www.ruanyifeng.com',
      tags: 'WebClipper',
    });
    expect(parsed.body).toBe('# Title\nBody');
  });

  test('supports quoted scalar values and dash lists', () => {
    const parsed = parseFrontmatter('---\ntitle: "A: B"\ntags:\n  - one\n  - two\n---\nbody');
    expect(parsed.meta.title).toBe('A: B');
    expect(parsed.meta.tags).toBe('one, two');
    expect(parsed.body).toBe('body');
  });

  test('leaves plain markdown and unclosed blocks untouched', () => {
    expect(parseFrontmatter('# Title\nBody')).toEqual({ meta: {}, body: '# Title\nBody' });
    expect(parseFrontmatter('---\nkey: value\n# Still markdown')).toEqual({
      meta: {},
      body: '---\nkey: value\n# Still markdown',
    });
  });

  test('strips the duplicated H1 when it matches the page title', () => {
    const body = '# 科技爱好者周刊（第 403 期）：为什么 Dropbox 不成功\n\n> 来源: xxx';
    const title = '科技爱好者周刊（第 403 期）：为什么 Dropbox 不成功 - 阮一峰的网络日志';
    expect(stripDuplicateHeading(body, title)).toBe('> 来源: xxx');
  });

  test('keeps a short or unrelated H1', () => {
    expect(stripDuplicateHeading('# Intro\n\ntext', 'A totally different title')).toBe(
      '# Intro\n\ntext'
    );
  });

  test('builds a callout with native links and labels', () => {
    const callout = buildCallout({
      source: 'www.ruanyifeng.com',
      tags: 'WebClipper',
      author: '',
    });
    expect(callout).toContain('<callout icon="📎">');
    expect(callout).toContain('来源: [www.ruanyifeng.com](https://www.ruanyifeng.com)');
    expect(callout).toContain('标签: WebClipper');
    expect(callout).not.toContain('作者');
  });
});


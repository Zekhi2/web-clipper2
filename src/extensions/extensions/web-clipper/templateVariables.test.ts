import { describe, it, expect } from 'vitest';
import {
  countChars,
  countEnglishWords,
  countHanzi,
  countParagraphs,
  countWords,
  extractTemplateVariables,
  getDate,
  getTime,
} from './templateVariables';

interface FakeMeta {
  name?: string;
  property?: string;
  content: string;
}

const fakeDocument = (options: {
  title?: string;
  url?: string;
  metas?: FakeMeta[];
  jsonLd?: string[];
}) => {
  const { title = 'Test Title', url = 'https://example.com/blog/post', metas = [], jsonLd = [] } = options;
  const findMeta = (selector: string) => {
    const match = selector.match(/meta\[([a-z]+)="([^"]+)"/);
    if (!match) {
      return null;
    }
    const [, attr, value] = match;
    const meta = metas.find(m => (attr === 'name' ? m.name : m.property) === value);
    if (!meta) {
      return null;
    }
    return {
      getAttribute: (attribute: string) => (attribute === 'content' ? meta.content : null),
    };
  };
  const scripts = jsonLd.map(text => ({ textContent: text }));
  return {
    title,
    URL: url,
    querySelector: findMeta,
    querySelectorAll: () => scripts,
  } as any;
};

describe('extractTemplateVariables', () => {
  it('extracts title, url and domain', () => {
    const variables = extractTemplateVariables(fakeDocument({}));
    expect(variables.TITLE).toBe('Test Title');
    expect(variables.URL).toBe('https://example.com/blog/post');
    expect(variables.DOMAIN).toBe('example.com');
  });

  it('returns empty domain for an invalid url', () => {
    const variables = extractTemplateVariables(fakeDocument({ url: 'not-a-url' }));
    expect(variables.DOMAIN).toBe('');
  });

  it('extracts author from meta tag', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ name: 'author', content: ' Alice ' }] })
    );
    expect(variables.AUTHOR).toBe('Alice');
  });

  it('falls back to JSON-LD author (string, object and array)', () => {
    const jsonLd = [
      JSON.stringify({ '@graph': [{ datePublished: '2026-01-01' }] }),
      JSON.stringify({ author: { name: ' Bob ' } }),
    ];
    const variables = extractTemplateVariables(fakeDocument({ jsonLd }));
    expect(variables.AUTHOR).toBe('Bob');
  });

  it('joins multiple JSON-LD authors', () => {
    const jsonLd = [JSON.stringify({ author: [{ name: 'A' }, 'B', {}] })];
    const variables = extractTemplateVariables(fakeDocument({ jsonLd }));
    expect(variables.AUTHOR).toBe('A, B');
  });

  it('ignores invalid JSON-LD', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ jsonLd: ['{ not valid json'] })
    );
    expect(variables.AUTHOR).toBe('');
    expect(variables.PUBLISHED).toBe('');
  });

  it('extracts description from meta description or og:description', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ name: 'description', content: 'page desc' }] })
    );
    expect(variables.DESCRIPTION).toBe('page desc');

    const ogVariables = extractTemplateVariables(
      fakeDocument({ metas: [{ property: 'og:description', content: 'og desc' }] })
    );
    expect(ogVariables.DESCRIPTION).toBe('og desc');
  });

  it('extracts published date from article:published_time or JSON-LD', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ property: 'article:published_time', content: '2026-01-01T08:00:00Z' }] })
    );
    expect(variables.PUBLISHED).toBe('2026-01-01T08:00:00Z');

    const jsonLdVariables = extractTemplateVariables(
      fakeDocument({ jsonLd: [JSON.stringify({ datePublished: '2026-02-02' })] })
    );
    expect(jsonLdVariables.PUBLISHED).toBe('2026-02-02');
  });

  it('extracts site name from og:site_name or application-name', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ property: 'og:site_name', content: 'Example' }] })
    );
    expect(variables.SITE).toBe('Example');

    const fallback = extractTemplateVariables(
      fakeDocument({ metas: [{ name: 'application-name', content: 'Example App' }] })
    );
    expect(fallback.SITE).toBe('Example App');
  });

  it('extracts image from og:image or twitter:image', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ property: 'og:image', content: 'https://example.com/og.png' }] })
    );
    expect(variables.IMAGE).toBe('https://example.com/og.png');

    const fallback = extractTemplateVariables(
      fakeDocument({ metas: [{ name: 'twitter:image', content: 'https://example.com/tw.png' }] })
    );
    expect(fallback.IMAGE).toBe('https://example.com/tw.png');
  });

  it('returns empty strings when nothing matches', () => {
    const variables = extractTemplateVariables(fakeDocument({}));
    expect(variables.AUTHOR).toBe('');
    expect(variables.DESCRIPTION).toBe('');
    expect(variables.PUBLISHED).toBe('');
    expect(variables.SITE).toBe('');
    expect(variables.IMAGE).toBe('');
  });
});

describe('countWords', () => {
  it('counts latin tokens', () => {
    expect(countWords('Hello world, hello world_2')).toBe(4);
  });

  it('counts each CJK character as one word', () => {
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('こんにちは、世界')).toBe(7);
    expect(countWords('안녕 세상')).toBe(4);
  });

  it('counts mixed content', () => {
    expect(countWords('Hello 你好 world')).toBe(4);
  });

  it('returns 0 for empty content', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t')).toBe(0);
  });
});

describe('countHanzi', () => {
  it('counts Han characters only, excluding CJK punctuation', () => {
    expect(countHanzi('你好，世界。')).toBe(4);
  });

  it('does not count latin text, kana or hangul', () => {
    expect(countHanzi('Hello 世界')).toBe(2);
    expect(countHanzi('こんにちは、世界')).toBe(2);
    expect(countHanzi('안녕 세상')).toBe(0);
  });

  it('returns 0 for empty content', () => {
    expect(countHanzi('')).toBe(0);
    expect(countHanzi('abc 123')).toBe(0);
  });
});

describe('countEnglishWords', () => {
  it('counts latin tokens including digits, underscores and apostrophes', () => {
    expect(countEnglishWords("Hello, world! foo_bar don't")).toBe(4);
    expect(countEnglishWords('since 2026')).toBe(2);
  });

  it('does not count Chinese characters', () => {
    expect(countEnglishWords('你好 world')).toBe(1);
  });

  it('returns 0 for empty content', () => {
    expect(countEnglishWords('')).toBe(0);
    expect(countEnglishWords('你好，世界。')).toBe(0);
  });
});

describe('countParagraphs', () => {
  it('counts non-empty blocks separated by blank lines', () => {
    expect(countParagraphs('first\n\nsecond\n\nthird')).toBe(3);
    expect(countParagraphs('first\nsecond\n\nthird')).toBe(2);
  });

  it('counts each fenced code block as one paragraph', () => {
    const content = '```\nconst a = 1;\n\nconst b = 2;\n```\n\nafter the code';
    expect(countParagraphs(content)).toBe(2);
  });

  it('ignores whitespace-only blocks and CRLF line endings', () => {
    expect(countParagraphs('first\r\n\r\n   \r\n\r\nsecond')).toBe(2);
  });

  it('returns 0 for empty content', () => {
    expect(countParagraphs('')).toBe(0);
    expect(countParagraphs('\n\n\n')).toBe(0);
  });
});

describe('countChars', () => {
  it('counts non-whitespace characters including punctuation and markdown syntax', () => {
    expect(countChars('Hello 世界。\n\nBye')).toBe(11);
    expect(countChars('# Title')).toBe(6);
  });

  it('returns 0 for empty or whitespace-only content', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('  \n\t  ')).toBe(0);
  });
});

describe('getDate and getTime', () => {
  it('formats the current date', () => {
    expect(getDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats the current time', () => {
    expect(getTime()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

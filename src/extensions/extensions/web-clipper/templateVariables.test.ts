import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  countChars,
  countEnglishWords,
  countHanzi,
  countParagraphs,
  countWords,
  extractTemplateVariables,
  extractTemplateVariablesAsync,
  getDate,
  getPublishedFromUrl,
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
  time?: string;
  link?: { href: string };
}) => {
  const {
    title = 'Test Title',
    url = 'https://example.com/blog/post',
    metas = [],
    jsonLd = [],
    time,
    link,
  } = options;
  const findMeta = (selector: string) => {
    if (selector === 'time[datetime]') {
      return {
        getAttribute: (attribute: string) => (attribute === 'datetime' ? time : null),
      };
    }
    if (selector === 'link[rel~="manifest"]') {
      return {
        getAttribute: (attribute: string) => (attribute === 'href' ? link?.href ?? null : null),
      };
    }
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
    baseURI: url,
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

  it('falls back to apple-mobile-web-app-title', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ metas: [{ name: 'apple-mobile-web-app-title', content: 'PWA Name' }] })
    );
    expect(variables.SITE).toBe('PWA Name');
  });

  it('accepts site name tails up to 20 characters', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ title: 'How to Build X - The New York Times' })
    );
    expect(variables.SITE).toBe('The New York Times');
  });

  it('rejects title tails longer than 20 characters and falls back to the prefix', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ title: 'How to Build X - A Really Long Publication Name Here!' })
    );
    // the overlong tail is rejected, but the two-segment prefix guess then
    // yields `How to Build X`
    expect(variables.SITE).toBe('How to Build X');
  });

  it('guesses the site name from a two-segment title prefix', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ title: '少数派 | 一篇非常非常非常长的文章标题已经超过了二十个字符的限制' })
    );
    expect(variables.SITE).toBe('少数派');

    const english = extractTemplateVariables(
      fakeDocument({ title: 'Tech Site | A Very Long Article Title That Nobody Would Call A Site Name' })
    );
    expect(english.SITE).toBe('Tech Site');
  });

  it('rejects implausible title prefixes', () => {
    // three segments: not a `Site | Title` pattern
    expect(
      extractTemplateVariables(
        fakeDocument({ title: 'Site | Category | An Extremely Long Article Title Beyond Twenty Characters' })
      ).SITE
    ).toBe('');
    // numeric prefix
    expect(
      extractTemplateVariables(
        fakeDocument({ title: '2026 | An Extremely Long Article Title Beyond Twenty Characters' })
      ).SITE
    ).toBe('');
    // overlong prefix (and overlong tail, so the suffix guess fails too)
    expect(
      extractTemplateVariables(
        fakeDocument({
          title:
            'An Extremely Long Opening Segment Beyond Twenty Characters | And A Very Long Tail That Also Exceeds Twenty Chars',
        })
      ).SITE
    ).toBe('');
  });

  it('falls back to JSON-LD publisher for the site name', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ jsonLd: [JSON.stringify({ publisher: { name: 'Example Press' } })] })
    );
    expect(variables.SITE).toBe('Example Press');
  });

  it('guesses the site name from the title suffix', () => {
    // e.g. news.eol.cn: no og:site_name, no application-name, no JSON-LD publisher
    const variables = extractTemplateVariables(
      fakeDocument({ title: '人类历史上的四次信息技术革命-教育在线' })
    );
    expect(variables.SITE).toBe('教育在线');

    const piped = extractTemplateVariables(
      fakeDocument({ title: 'Some Article | Tech Site' })
    );
    expect(piped.SITE).toBe('Tech Site');
  });

  it('does not guess a site name from titles without a suffix or with a numeric tail', () => {
    expect(
      extractTemplateVariables(fakeDocument({ title: '人类历史上的四次信息技术革命' })).SITE
    ).toBe('');
    expect(extractTemplateVariables(fakeDocument({ title: 'Report 2023-02-27' })).SITE).toBe('');
    expect(
      extractTemplateVariables(fakeDocument({ title: 'A Very Long Article Title Indeed' })).SITE
    ).toBe('');
  });

  it('falls back to Baidu-style pubDate and <time datetime> for the published date', () => {
    const pubDateVariables = extractTemplateVariables(
      fakeDocument({ jsonLd: [JSON.stringify({ pubDate: '2026-03-03T09:00:00' })] })
    );
    expect(pubDateVariables.PUBLISHED).toBe('2026-03-03T09:00:00');

    const timeVariables = extractTemplateVariables(fakeDocument({ time: ' 2026-04-04 ' }));
    expect(timeVariables.PUBLISHED).toBe('2026-04-04');
  });

  it('infers the publish date from the URL when nothing is declared', () => {
    const variables = extractTemplateVariables(
      fakeDocument({ url: 'https://news.eol.cn/lzmzl/202302/t20230227_2305759.shtml' })
    );
    expect(variables.PUBLISHED).toBe('2023-02-27');
  });

  it('prefers the URL date when the declared date conflicts on the year', () => {
    // eol.cn restamps pubDate when it regenerates a page; the URL date is frozen
    // at publish time and matches the visible article date.
    const variables = extractTemplateVariables(
      fakeDocument({
        url: 'https://news.eol.cn/lzmzl/202302/t20230227_2305759.shtml',
        jsonLd: [JSON.stringify({ pubDate: '2026-08-03T10:50:54' })],
      })
    );
    expect(variables.PUBLISHED).toBe('2023-02-27');
  });

  it('keeps the declared value when its year matches the URL date', () => {
    const variables = extractTemplateVariables(
      fakeDocument({
        url: 'https://news.eol.cn/lzmzl/202302/t20230227_2305759.shtml',
        jsonLd: [JSON.stringify({ datePublished: '2023-02-27T08:00:00' })],
      })
    );
    expect(variables.PUBLISHED).toBe('2023-02-27T08:00:00');
  });

  it('extracts the updated date from article:modified_time, dateModified or upDate', () => {
    const metaVariables = extractTemplateVariables(
      fakeDocument({ metas: [{ property: 'article:modified_time', content: '2026-05-05' }] })
    );
    expect(metaVariables.UPDATED).toBe('2026-05-05');

    const dateModifiedVariables = extractTemplateVariables(
      fakeDocument({ jsonLd: [JSON.stringify({ dateModified: '2026-06-06' })] })
    );
    expect(dateModifiedVariables.UPDATED).toBe('2026-06-06');

    const upDateVariables = extractTemplateVariables(
      fakeDocument({ jsonLd: [JSON.stringify({ upDate: '2026-08-03T10:50:54' })] })
    );
    expect(upDateVariables.UPDATED).toBe('2026-08-03T10:50:54');

    expect(extractTemplateVariables(fakeDocument({})).UPDATED).toBe('');
  });

  it('extracts author from article:author when meta author is empty', () => {
    const variables = extractTemplateVariables(
      fakeDocument({
        metas: [
          { name: 'author', content: '' },
          { property: 'article:author', content: 'Jane' },
        ],
      })
    );
    expect(variables.AUTHOR).toBe('Jane');
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

describe('extractTemplateVariablesAsync (manifest fallback)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills the site name from the web app manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name: 'Example Site', short_name: 'Example' }),
        })
      )
    );
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({ link: { href: '/manifest.json' } })
    );
    expect(variables.SITE).toBe('Example Site');
  });

  it('uses short_name when the manifest has no name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ short_name: 'Shorty' }) }))
    );
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({ link: { href: 'https://cdn.example.com/appmanifest.json' } })
    );
    expect(variables.SITE).toBe('Shorty');
  });

  it('does not fetch a manifest when a site name was already found', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({
        metas: [{ property: 'og:site_name', content: 'Declared' }],
        link: { href: '/manifest.json' },
      })
    );
    expect(variables.SITE).toBe('Declared');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently ignores manifest failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('CORS')))
    );
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({ link: { href: '/manifest.json' } })
    );
    expect(variables.SITE).toBe('');
  });

  it('silently ignores a manifest without usable names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    );
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({ link: { href: '/manifest.json' } })
    );
    expect(variables.SITE).toBe('');
  });

  it('silently ignores an HTTP error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ name: 'Nope' }) }))
    );
    const variables = await extractTemplateVariablesAsync(
      fakeDocument({ link: { href: '/manifest.json' } })
    );
    expect(variables.SITE).toBe('');
  });
});

describe('getPublishedFromUrl', () => {
  it('extracts dates from common CMS URL patterns', () => {
    expect(getPublishedFromUrl('https://news.eol.cn/lzmzl/202302/t20230227_2305759.shtml')).toBe(
      '2023-02-27'
    );
    expect(getPublishedFromUrl('https://example.com/news/2023/02/27/post.html')).toBe('2023-02-27');
    expect(getPublishedFromUrl('https://example.com/2023-02-27-article')).toBe('2023-02-27');
    expect(getPublishedFromUrl('https://example.com/c/2024-11-8/123.shtml')).toBe('2024-11-08');
  });

  it('rejects digit runs that are not plausible dates', () => {
    // a random 8-digit id: month 56 is invalid
    expect(getPublishedFromUrl('https://example.com/p/12345678.html')).toBe('');
    // year out of range
    expect(getPublishedFromUrl('https://example.com/p/87654321.html')).toBe('');
    expect(getPublishedFromUrl('https://example.com/p/18991231.html')).toBe('');
    // impossible calendar date (Feb 31)
    expect(getPublishedFromUrl('https://example.com/2023/02/31/post.html')).toBe('');
    // year/month only, no day
    expect(getPublishedFromUrl('https://example.com/2015/03/article-title.html')).toBe('');
    // not a date at all
    expect(getPublishedFromUrl('https://example.com/blog/post')).toBe('');
    expect(getPublishedFromUrl('not-a-url')).toBe('');
  });

  it('does not match inside longer word tokens', () => {
    expect(getPublishedFromUrl('https://example.com/x20230227y.html')).toBe('');
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

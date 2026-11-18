import { describe, test, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import NotionDocumentService from '@/common/backend/services/notion/service';

vi.mock('@/common/locales', () => ({
  default: {
    format: (d: { id?: string; defaultMessage?: string }) => d.defaultMessage ?? '',
  },
}));

const searchItem = (id: string, object: string, title: string) => ({
  id,
  object,
  url: `https://www.notion.so/${id}`,
  properties: {
    Name: {
      type: 'title',
      title: [{ plain_text: title, text: { content: title } }],
    },
  },
});

function setup(responses: (url: string, data?: any) => any, config: Record<string, any> = {}) {
  const calls: Array<{ method: string; url: string; data?: any }> = [];
  const responseHandlers: Array<[(r: any) => any, (e: any) => any]> = [];
  const applyInterceptors = (promise: Promise<any>) =>
    responseHandlers.reduce((p, [ok, fail]) => p.then(ok, fail), promise);

  const instance = {
    interceptors: {
      request: { use: vi.fn() },
      response: {
        use: (ok: any, fail: any) => responseHandlers.push([ok, fail]),
      },
    },
    get: (url: string) => {
      calls.push({ method: 'GET', url });
      return applyInterceptors(Promise.resolve().then(() => responses(url)));
    },
    post: (url: string, data: any) => {
      calls.push({ method: 'POST', url, data });
      return applyInterceptors(Promise.resolve().then(() => responses(url, data)));
    },
    patch: (url: string, data: any) => {
      calls.push({ method: 'PATCH', url, data });
      return applyInterceptors(Promise.resolve().then(() => responses(url, data)));
    },
  };
  vi.spyOn(axios, 'create').mockReturnValue(instance as any);
  return {
    service: new NotionDocumentService({ personalAccessToken: 'ntn_test', ...config }),
    calls,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('NotionDocumentService (official REST API + PAT)', () => {
  test('rejects a missing token', () => {
    expect(() => new NotionDocumentService({})).toThrow(/Personal Access Token/);
  });

  test('getUserInfo calls /users/me', async () => {
    const { service } = setup((url) => {
      if (url === '/users/me') {
        return { data: { id: 'u1', name: 'Clipper', avatar_url: null, person: { email: 'a@b.c' } } };
      }
      return { data: null };
    });
    expect(await service.getUserInfo()).toMatchObject({
      name: 'Clipper',
      description: 'a@b.c',
    });
  });

  test('getRepositories uses /search and caches the result', async () => {
    let searches = 0;
    const { service } = setup((url) => {
      if (url === '/search') {
        searches++;
        return {
          data: {
            results: [
              searchItem('pg', 'page', 'My Page'),
              searchItem('db', 'database', 'My DB'),
              searchItem('ds', 'data_source', 'My DS'),
              searchItem('user', 'user', 'ignored'),
            ],
            has_more: false,
            next_cursor: null,
          },
        };
      }
      return { data: null };
    });
    const repos = await service.getRepositories();
    expect(repos.map((r) => r.id)).toEqual(['pg', 'db', 'ds']);
    expect(repos[0].notionObjectType).toBe('page');
    await service.getRepositories();
    expect(searches).toBe(1);
  });

  test('createDocument posts markdown v2 to a page parent', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages') {
        return { data: { id: 'new-1', url: 'https://www.notion.so/new1' } };
      }
      return { data: null };
    });
    const result = await service.createDocument({
      repositoryId: 'pg',
      title: 'Clip title',
      content: 'hello',
    });
    expect(result.href).toBe('https://www.notion.so/new1');
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.parent).toEqual({ page_id: 'pg' });
    expect(body.markdown_version).toBe('v2');
    expect(body.properties.title.title[0].text.content).toBe('Clip title');
    expect(body.markdown).toBe('hello');
  });

  test('createDocument resolves the real title property for a data source', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages/ds1') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/databases/ds1') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/data_sources/ds1') {
        return { data: { properties: { Name: { type: 'title' }, Done: { type: 'checkbox' } } } };
      }
      if (url === '/pages') {
        return { data: { id: 'new-2', url: 'https://www.notion.so/new2' } };
      }
      return { data: null };
    });
    await service.createDocument({ repositoryId: 'ds1', title: 'Row', content: 'body' });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.parent).toEqual({ data_source_id: 'ds1' });
    expect(body.properties.Name.title[0].text.content).toBe('Row');
  });

  test('frontmatter becomes a callout on a page parent and the duplicate H1 is removed', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages') {
        return { data: { id: 'new-3', url: 'https://www.notion.so/new3' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'pg',
      title: '科技爱好者周刊（第 403 期）：为什么 Dropbox 不成功 - 阮一峰的网络日志',
      content: [
        '---',
        'clipped: 2026-11-17',
        'source: www.ruanyifeng.com',
        'tags: WebClipper',
        '---',
        '# 科技爱好者周刊（第 403 期）：为什么 Dropbox 不成功',
        '',
        '> 来源: [阮一峰的网络日志](https://www.ruanyifeng.com/blog/2026/07/weekly-issue-403.html)',
      ].join('\n'),
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.markdown).toContain('<callout icon="📎">');
    expect(body.markdown).toContain('来源: [www.ruanyifeng.com](https://www.ruanyifeng.com)');
    expect(body.markdown).toContain('标签: WebClipper');
    expect(body.markdown).not.toContain('clipped:');
    expect(body.markdown).not.toContain('# 科技爱好者周刊');
    expect(body.markdown).toContain('> 来源:');
  });

  test('frontmatter maps to real database properties by name and type', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages/ds2' || url === '/databases/ds2') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/data_sources/ds2') {
        return {
          data: {
            properties: {
              Name: { type: 'title' },
              Clipped: { type: 'date' },
              Source: { type: 'url' },
              Tags: { type: 'multi_select' },
              Author: { type: 'rich_text' },
            },
          },
        };
      }
      if (url === '/pages') {
        return { data: { id: 'new-4', url: 'https://www.notion.so/new4' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'ds2',
      title: 'Clip title',
      content: [
        '---',
        'clipped: 2026-11-17',
        'source: www.ruanyifeng.com',
        'tags: WebClipper, Notion',
        'author: 阮一峰',
        'unmapped: keep me',
        '---',
        '# Clip title',
        'hello',
      ].join('\n'),
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.properties).toMatchObject({
      Name: { title: [{ text: { content: 'Clip title' } }] },
      Clipped: { date: { start: '2026-11-17' } },
      Source: { url: 'https://www.ruanyifeng.com' },
      Tags: { multi_select: [{ name: 'WebClipper' }, { name: 'Notion' }] },
      Author: { rich_text: [{ text: { content: '阮一峰' } }] },
    });
    expect(body.properties.unmapped).toBeUndefined();
    expect(body.markdown).toContain('unmapped: keep me');
    expect(body.markdown).not.toContain('clipped:');
  });

  test('aliases match the Web Clips template and read-only properties are skipped', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages/ds3' || url === '/databases/ds3') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/data_sources/ds3') {
        return {
          data: {
            properties: {
              Title: { type: 'title' },
              'userDefined:URL': { type: 'url' },
              Source: { type: 'formula' },
              Tags: { type: 'multi_select' },
              Author: { type: 'rich_text' },
              Published: { type: 'date' },
              'Created at': { type: 'created_time' },
            },
          },
        };
      }
      if (url === '/pages') {
        return { data: { id: 'new-5', url: 'https://www.notion.so/new5' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'ds3',
      title: '科技爱好者周刊（第 403 期）',
      content: [
        '---',
        'clipped: 2026-11-17',
        'source: www.ruanyifeng.com',
        'author: ',
        'published: ',
        'tags: WebClipper',
        '---',
        '# 科技爱好者周刊（第 403 期）',
        'hello',
      ].join('\n'),
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.properties).toMatchObject({
      Title: { title: [{ text: { content: '科技爱好者周刊（第 403 期）' } }] },
      'userDefined:URL': { url: 'https://www.ruanyifeng.com' },
      Tags: { multi_select: [{ name: 'WebClipper' }] },
    });
    // The formula property must never be written.
    expect(body.properties.Source).toBeUndefined();
    // Empty fields and `clipped` (covered by `Created at`) stay out entirely.
    expect(body.properties.Author).toBeUndefined();
    expect(body.properties.Published).toBeUndefined();
    expect(body.markdown).not.toContain('clipped');
    expect(body.markdown).not.toContain('作者');
    expect(body.markdown).toContain('hello');
  });

  test('frontmatter category maps to the Category select property', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages/ds4' || url === '/databases/ds4') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/data_sources/ds4') {
        return {
          data: {
            properties: {
              Title: { type: 'title' },
              Category: {
                type: 'select',
                select: {
                  options: [
                    { name: '📄 Article' },
                    { name: '🎬 Video' },
                    { name: '🔖 Bookmark' },
                  ],
                },
              },
            },
          },
        };
      }
      if (url === '/pages') {
        return { data: { id: 'new-6', url: 'https://www.notion.so/new6' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'ds4',
      title: 'A video clip',
      content: ['---', 'source: youtu.be/abc', 'category: 🎬 Video', '---', 'hello'].join('\n'),
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.properties.Category).toEqual({ select: { name: '🎬 Video' } });
    expect(body.properties['userDefined:URL']).toBeUndefined(); // youtu.be is not a bare domain
    expect(body.markdown).not.toContain('category:');
  });

  test('bookmark stubs are classified when the template has no category', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages/ds5' || url === '/databases/ds5') {
        return Promise.reject({ response: { status: 404 } });
      }
      if (url === '/data_sources/ds5') {
        return {
          data: {
            properties: {
              Title: { type: 'title' },
              Category: { type: 'select' },
            },
          },
        };
      }
      if (url === '/pages') {
        return { data: { id: 'new-7', url: 'https://www.notion.so/new7' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'ds5',
      title: 'A saved link',
      content: [
        '---',
        'clipped: 2026-11-18',
        'source: example.com',
        '---',
        '## Link \n [https://example.com](https://example.com) \n ## Comment:',
      ].join('\n'),
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.properties.Category).toEqual({ select: { name: '🔖 Bookmark' } });
  });

  test('a 401 is reported as an invalid token', async () => {
    const { service } = setup((url) => {
      if (url === '/users/me') {
        return Promise.reject({ response: { status: 401, data: { message: 'Unauthorized' } } });
      }
      return { data: null };
    });
    await expect(service.getUserInfo()).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: expect.stringMatching(/Invalid Notion Personal Access Token/),
    });
  });
});

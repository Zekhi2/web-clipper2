import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import Container from 'typedi';
import NotionDocumentService from '@/common/backend/services/notion/service';
import { IBasicRequestService } from '@/service/common/request';
import { buildNotionProbeUrl } from '@/common/backend/services/notion/imageHandling';

vi.mock('antd', () => ({
  message: {
    loading: vi.fn(() => ({})),
    destroy: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}));

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

afterEach(() => {
  vi.unstubAllGlobals();
  Container.remove(IBasicRequestService);
});

function installDownloader(
  fn: (url: string) => Promise<Blob>
) {
  const download = vi.fn(fn);
  Container.set(IBasicRequestService, { download } as any);
  return download;
}

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

  test('inline images in the clip content are normalized to standalone blocks', async () => {
    const { service, calls } = setup((url) => {
      if (url === '/pages') {
        return { data: { id: 'new-8', url: 'https://www.notion.so/new8' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'pg',
      title: 'With images',
      content: 'see ![img](https://example.com/a.jpg) here',
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.markdown).toBe('see\n\n![img](https://example.com/a.jpg)\n\nhere');
  });

  test('auto probes through Notion and keeps original URLs for images Notion can fetch', async () => {
    const download = installDownloader(async () => new Blob(['x'], { type: 'image/jpeg' }));
    const { service, calls } = setup((url) => {
      if (url === '/pages') {
        return { data: { id: 'new-9', url: 'https://www.notion.so/new9' } };
      }
      return { data: null };
    });
    await service.createDocument({
      repositoryId: 'pg',
      title: 'Accessible image',
      content: '![img](https://cdn.example.com/a.jpg)',
    });
    // The probe went through Notion's own image endpoint, not the source URL.
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0]).toBe(buildNotionProbeUrl('https://cdn.example.com/a.jpg'));
    // No rehosting traffic (only the parent-type GET and the page POST).
    expect(calls.every((call) => call.url === '/pages' || call.url === '/pages/pg')).toBe(true);
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.markdown).toBe('![img](https://cdn.example.com/a.jpg)');
  });

  test('never mode does not probe or rehost at all', async () => {
    const download = vi.fn();
    Container.set(IBasicRequestService, { download } as any);
    const { service, calls } = setup(
      (url) => {
        if (url === '/pages') {
          return { data: { id: 'new-10', url: 'https://www.notion.so/new10' } };
        }
        return { data: null };
      },
      { imageHandling: 'never' }
    );
    await service.createDocument({
      repositoryId: 'pg',
      title: 'Untouched images',
      content: '![img](https://pic3.zhimg.com/a.jpg)',
    });
    expect(download).not.toHaveBeenCalled();
    expect(calls.every((call) => call.url === '/pages' || call.url === '/pages/pg')).toBe(true);
  });

  test('images Notion cannot fetch are rehosted through the Notion File Upload API', async () => {
    // Notion's image endpoint reports a failure for the source (e.g. the
    // 504 returned by anti-bot CDNs); the browser identity can still fetch
    // the real bytes from the source URL for the upload.
    const download = installDownloader(async (url) =>
      url.startsWith('https://img.notionusercontent.com/')
        ? new Blob(['504'], { type: 'application/octet-stream' })
        : new Blob(['x'], { type: 'image/jpeg' })
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'uploaded' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, calls } = setup(
      (url) => {
        if (url === '/pages') {
          return { data: { id: 'pg9', url: 'https://www.notion.so/pg9' } };
        }
        if (url === '/blocks/pg9/children') {
          return {
            data: {
              results: [
                {
                  type: 'image',
                  id: 'b1',
                  image: { external: { url: 'https://pic3.zhimg.com/a.jpg' } },
                },
                { type: 'paragraph', id: 'b2' },
              ],
            },
          };
        }
        if (url === '/file_uploads') {
          return { data: { id: 'fu1', upload_url: 'https://upload.notion.com/fu1' } };
        }
        return { data: null };
      },
      { imageHandling: 'auto', rehostTarget: 'notion' }
    );
    await service.createDocument({
      repositoryId: 'pg',
      title: 'Blocked image',
      content: '![img](https://pic3.zhimg.com/a.jpg)',
    });
    // The page is created with the original URL first; the block is patched
    // to the Notion-hosted upload afterwards.
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.markdown).toBe('![img](https://pic3.zhimg.com/a.jpg)');
    expect(calls.some((call) => call.url === '/blocks/pg9/children' && call.method === 'GET')).toBe(
      true
    );
    expect(calls.some((call) => call.url === '/file_uploads' && call.method === 'POST')).toBe(true);
    // One Notion probe download + one browser-identity download of
    // the actual bytes for the upload.
    expect(download).toHaveBeenCalledTimes(2);
    // The pre-signed upload URL is hit with a bare fetch (no auth headers).
    expect(fetchMock).toHaveBeenCalledWith('https://upload.notion.com/fu1', expect.anything());
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.url).toBe('/blocks/b1');
    expect(patch.data).toEqual({
      image: { type: 'file_upload', file_upload: { id: 'fu1' } },
    });
  });

  test('auto fails closed when the Notion probe itself fails', async () => {
    // The probe request errors before returning any verdict: nothing can be
    // verified, so nothing is kept.
    const download = installDownloader(async (url) => {
      if (url.startsWith('https://img.notionusercontent.com/')) {
        throw new Error('probe endpoint unreachable');
      }
      return new Blob(['x'], { type: 'image/jpeg' });
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'uploaded' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, calls } = setup(
      (url) => {
        if (url === '/pages') {
          return { data: { id: 'pg10', url: 'https://www.notion.so/pg10' } };
        }
        if (url === '/blocks/pg10/children') {
          return {
            data: {
              results: [
                {
                  type: 'image',
                  id: 'c1',
                  image: { external: { url: 'https://cdn.example.com/a.jpg' } },
                },
              ],
            },
          };
        }
        if (url === '/file_uploads') {
          return { data: { id: 'fu2', upload_url: 'https://upload.notion.com/fu2' } };
        }
        return { data: null };
      },
      { imageHandling: 'auto', rehostTarget: 'notion' }
    );
    await service.createDocument({
      repositoryId: 'pg',
      title: 'Unverifiable image',
      content: '![img](https://cdn.example.com/a.jpg)',
    });
    const body = calls.find((call) => call.url === '/pages')!.data;
    expect(body.markdown).toBe('![img](https://cdn.example.com/a.jpg)');
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.data).toEqual({
      image: { type: 'file_upload', file_upload: { id: 'fu2' } },
    });
    // One failed Notion probe + one browser-identity download for the upload.
    expect(download).toHaveBeenCalledTimes(2);
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

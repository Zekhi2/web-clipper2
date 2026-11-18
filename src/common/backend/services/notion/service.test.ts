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

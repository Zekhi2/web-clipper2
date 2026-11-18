import localeService from '@/common/locales';
import axios, { AxiosInstance } from 'axios';
import { CreateDocumentRequest, DocumentService } from '../../index';
import { CompleteStatus, UnauthorizedError } from './../interface';
import { NotionRepository } from './types';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_SEARCH_PAGES = 5;

type NotionObjectType = 'page' | 'database' | 'data_source';

interface NotionServiceConfig {
  personalAccessToken?: string;
}

interface NotionUserResponse {
  id: string;
  name: string;
  avatar_url: string | null;
  email?: string;
  person?: { email: string };
}

interface NotionSearchItem {
  id: string;
  url: string;
  object: string;
  title?: Array<{ plain_text: string }>;
  properties?: Record<string, any>;
  parent?: {
    type?: string;
    workspace?: boolean;
  } | null;
}

interface NotionSearchResponse {
  results: NotionSearchItem[];
  next_cursor: string | null;
  has_more: boolean;
}

interface NotionCreatePageResponse {
  id: string;
  url: string;
}

/**
 * Notion backend backed by the official REST API and a Personal Access Token.
 *
 * The old implementation borrowed the browser's notion.so cookies and called
 * Notion's private `api/v3` endpoints. Notion has since tightened security on
 * those endpoints so they return 401 even for logged-in users, which broke this
 * service (and every other clipper using the same trick).
 */
export default class NotionDocumentService implements DocumentService {
  private request: AxiosInstance;
  private repositories: NotionRepository[] = [];
  private me?: NotionUserResponse;
  /** Filled by getRepositories() so createDocument() can pick the right parent key. */
  private repositoryTypeMap: Record<string, NotionObjectType> = {};

  constructor(config: NotionServiceConfig = {}) {
    const token = (config.personalAccessToken || '').trim();
    if (!token) {
      throw new UnauthorizedError(
        localeService.format({
          id: 'backend.services.notion.pat.missing',
          defaultMessage:
            'Please add a Notion Personal Access Token (ntn_...) in the account settings.',
        })
      );
    }
    this.request = axios.create({
      baseURL: NOTION_API_BASE,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
        Authorization: `Bearer ${token}`,
      },
    });
    this.request.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          return Promise.reject(
            new UnauthorizedError(
              localeService.format({
                id: 'backend.services.notion.pat.invalid',
                defaultMessage:
                  'Invalid Notion Personal Access Token. Please recreate it and check page connections.',
              })
            )
          );
        }
        const data = error.response && error.response.data;
        if (data && data.message) {
          return Promise.reject(new Error(`Notion API (${data.status || 'err'}/${data.code || ''}): ${data.message}`));
        }
        return Promise.reject(error);
      }
    );
  }

  getId = () => {
    return 'notion';
  };

  getUserInfo = async () => {
    if (!this.me) {
      const { data } = await this.request.get<NotionUserResponse>('/users/me');
      this.me = data;
    }
    const user = this.me;
    const email = user.email || user.person?.email || '';
    return {
      name: user.name || 'Notion',
      avatar: user.avatar_url || 'https://www.notion.so/images/favicon.ico',
      homePage: 'https://www.notion.so/',
      description: email,
    };
  };

  private getTitle(item: NotionSearchItem): string {
    if (item.properties) {
      const titleProperty = Object.values<any>(item.properties).find(
        (property) => property && property.type === 'title' && Array.isArray(property.title)
      );
      if (titleProperty) {
        const title = titleProperty.title
          .map((part: any) => part.plain_text || part.text?.content || '')
          .join('');
        if (title.trim()) {
          return title;
        }
      }
    }
    if (Array.isArray(item.title)) {
      const title = item.title.map((part) => part.plain_text || '').join('');
      if (title.trim()) {
        return title;
      }
    }
    return localeService.format({
      id: 'backend.services.notion.untitled',
      defaultMessage: '(Untitled)',
    });
  }

  getRepositories = async (): Promise<NotionRepository[]> => {
    if (this.repositories.length > 0) {
      return this.repositories;
    }

    const result: NotionRepository[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const body: Record<string, any> = {
        page_size: 100,
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
      };
      if (cursor) {
        body.start_cursor = cursor;
      }
      const { data } = await this.request.post<NotionSearchResponse>('/search', body);
      data.results.forEach((item) => {
        if (item.object !== 'page' && item.object !== 'database' && item.object !== 'data_source') {
          return;
        }
        const objectType = item.object as NotionObjectType;
        result.push({
          id: item.id,
          name: `${objectType === 'page' ? '📄' : '🗃️'} ${this.getTitle(item)}`,
          groupId: 'workspace',
          groupName: 'Notion',
          notionObjectType: objectType,
        });
        this.repositoryTypeMap[item.id] = objectType;
      });
      cursor = data.has_more ? data.next_cursor : null;
      if (!cursor) {
        break;
      }
    }

    if (result.length === 0) {
      throw new Error(
        localeService.format({
          id: 'backend.services.notion.repository.empty',
          defaultMessage:
            'No pages or databases are accessible to this token. Open the target page in Notion → ... → Add connections → select your integration.',
        })
      );
    }
    this.repositories = result;
    return result;
  };

  /** Figure out which parent key `POST /pages` expects for a repository id. */
  private detectParentType = async (repositoryId: string): Promise<NotionObjectType> => {
    const known = this.repositoryTypeMap[repositoryId];
    if (known) {
      return known;
    }
    const candidates: Array<[NotionObjectType, string]> = [
      ['page', `/pages/${repositoryId}`],
      ['database', `/databases/${repositoryId}`],
      ['data_source', `/data_sources/${repositoryId}`],
    ];
    for (const [objectType, path] of candidates) {
      try {
        await this.request.get(path);
        this.repositoryTypeMap[repositoryId] = objectType;
        return objectType;
      } catch (_error) {
        // Try the next object type.
      }
    }
    throw new Error(
      localeService.format({
        id: 'backend.services.notion.repository.notFound',
        defaultMessage:
          'Repository not found or not shared with your integration. Open the page in Notion and connect your integration via the ... menu.',
      })
    );
  };

  /** Fetch the parent's property schema so frontmatter keys can be mapped to
   * real Notion properties (with their actual names and types). */
  private getParentProperties = async (
    repositoryId: string,
    objectType: NotionObjectType
  ): Promise<{ schema: Record<string, any>; titleName: string }> => {
    if (objectType === 'page') {
      return { schema: {}, titleName: 'title' };
    }
    try {
      const path =
        objectType === 'data_source'
          ? `/data_sources/${repositoryId}`
          : `/databases/${repositoryId}`;
      const { data } = await this.request.get(path);
      const schema: Record<string, any> = data.properties || {};
      const titleEntry = Object.entries<any>(schema).find(
        ([, property]) => property && property.type === 'title'
      );
      return { schema, titleName: titleEntry ? titleEntry[0] : 'title' };
    } catch (_error) {
      return { schema: {}, titleName: 'title' };
    }
  };

  createDocument = async ({
    title,
    content,
    repositoryId,
  }: CreateDocumentRequest): Promise<CompleteStatus> => {
    if (!repositoryId) {
      throw new Error(
        localeService.format({
          id: 'backend.services.notion.repository.required',
          defaultMessage: 'Please choose a default repository (Notion page or database) first.',
        })
      );
    }
    const objectType = await this.detectParentType(repositoryId);
    const safeTitle = title || 'Clipped Note';
    const parent =
      objectType === 'page'
        ? { page_id: repositoryId }
        : objectType === 'data_source'
        ? { data_source_id: repositoryId }
        : { database_id: repositoryId };

    const { titleName } = await this.getParentProperties(repositoryId, objectType);
    const properties: Record<string, any> = {
      [titleName]: { title: [{ text: { content: safeTitle } }] },
    };

    const body: Record<string, any> = {
      parent,
      icon: { emoji: '📌' },
      markdown_version: 'v2',
      markdown: content,
      properties,
    };

    const { data } = await this.request.post<NotionCreatePageResponse>('/pages', body);
    return {
      href: data.url || `https://www.notion.so/${data.id.replace(/-/g, '')}`,
    };
  };
}

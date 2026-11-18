import localeService from '@/common/locales';
import { CATEGORY_BOOKMARK, isBookmarkStub } from '@/common/clipCategory';
import axios, { AxiosInstance } from 'axios';
import { message } from 'antd';
import Container from 'typedi';
import { IBasicRequestService } from '@/service/common/request';
import { CreateDocumentRequest, DocumentService } from '../../index';
import { CompleteStatus, UnauthorizedError } from './../interface';
import { NotionRepository } from './types';
import { buildCallout, normalizeImageBlocks, parseFrontmatter, stripDuplicateHeading } from './frontmatter';
import {
  buildNotionProbeUrl,
  extensionForContentType,
  extractImageUrls,
  probeImageAccessibility,
  replaceImageUrls,
} from './imageHandling';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_SEARCH_PAGES = 5;
/** Guard against hung downloads during the accessibility probe. */
const IMAGE_DOWNLOAD_TIMEOUT = 20000;

type NotionObjectType = 'page' | 'database' | 'data_source';

/** When images should be rehosted instead of keeping their original URLs. */
type NotionImageHandling = 'auto' | 'always' | 'never';
/** Where rehosted images go. */
type NotionRehostTarget = 'auto' | 'imageHosting' | 'notion';

interface NotionServiceConfig {
  personalAccessToken?: string;
  imageHandling?: NotionImageHandling;
  rehostTarget?: NotionRehostTarget;
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

const toAbsoluteUrl = (value: string): string => {
  const trimmed = (value || '').trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // The clipper template stores bare domains in `source`, which Notion's URL
  // property rejects without a scheme.
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return '';
};

/** Some templates store properties under internal names such as
 * `userDefined:URL`; comparisons ignore everything before the colon. */
const normalizePropertyName = (name: string): string =>
  name.toLowerCase().replace(/^\w+:/, '');

/**
 * Frontmatter key → alternative database property names to try when no
 * property matches the key exactly (case-insensitive). The Web Clips template
 * stores the article link in a `URL` property while the template's `Source`
 * is a read-only formula, hence the `source` → `url` alias.
 */
const PROPERTY_ALIASES: Record<string, string[]> = {
  source: ['url', 'link', '链接', '来源'],
  tags: ['tag', '标签'],
  author: ['byline', '作者'],
  published: ['publish date', '发布时间', '发布日期'],
  updated: ['update date', '更新时间', '更新日期'],
};

/** System-managed property types that reject writes; values aimed at these
 * fall through to later candidates or the body callout. */
const READ_ONLY_PROPERTY_TYPES = new Set([
  'formula',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id',
]);

/** Frontmatter keys a database fills automatically (e.g. `Created at` covers
 * `clipped`); they are dropped instead of duplicated in the callout when no
 * explicit property matches. */
const AUTO_DATABASE_KEYS = new Set(['clipped']);

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
  /** Downloads performed during the image probe, reused when rehosting to
   * Notion so blocked images are fetched only once. */
  private imageBlobCache = new Map<string, Blob>();
  private imageHandling: NotionImageHandling;
  private rehostTarget: NotionRehostTarget;

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
    this.imageHandling = config.imageHandling || 'auto';
    this.rehostTarget = config.rehostTarget || 'auto';
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

  /** Convert a frontmatter value into a Notion property value for the given
   * schema type. Returns undefined when the type cannot be represented. */
  private toPropertyValue = (type: string, value: string): any => {
    switch (type) {
      case 'title':
      case 'rich_text':
        return { [type]: [{ text: { content: value } }] };
      case 'url': {
        const url = toAbsoluteUrl(value);
        return url ? { url } : undefined;
      }
      case 'date':
        return /^\d{4}-\d{2}-\d{2}/.test(value) ? { date: { start: value } } : undefined;
      case 'multi_select':
        return {
          multi_select: value
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .map((name) => ({ name })),
        };
      case 'select':
      case 'status':
        return { [type]: { name: value } };
      case 'number': {
        const number = Number(value);
        return Number.isFinite(number) ? { number } : undefined;
      }
      case 'checkbox':
        return { checkbox: /^(true|1|yes)$/i.test(value) };
      case 'email':
        return /@/.test(value) ? { email: value } : undefined;
      case 'phone_number':
        return { phone_number: value };
      case 'files': {
        const url = toAbsoluteUrl(value);
        return url ? { files: [{ name: url, external: { url } }] } : undefined;
      }
      default:
        return undefined;
    }
  };

  /** A single, replacesable progress notification for the image pipeline. */
  private progressKey = `notion-image-progress-${Date.now()}`;

  private showImageProgress = (id: string, defaultMessage: string, values?: Record<string, any>) => {
    message.destroy(this.progressKey);
    message.loading({
      content: localeService.format({ id, defaultMessage }, values),
      key: this.progressKey,
      duration: 0,
    });
  };

  private finishImageProgress = (failed: number) => {
    message.destroy(this.progressKey);
    if (failed > 0) {
      message.warning(
        localeService.format(
          {
            id: 'backend.services.notion.image.progress.failed',
            defaultMessage: '{count} image(s) could not be rehosted; original links were kept.',
          },
          { count: failed }
        )
      );
    }
  };

  /** Download an image with the user's (browser) identity, for rehosting.
   * The bytes the user's browser can fetch are what gets uploaded. Includes
   * a timeout so a hung CDN cannot stall the whole clip. */
  private downloadImage = (url: string): Promise<Blob> => {
    const existing = this.imageBlobCache.get(url);
    if (existing) {
      return Promise.resolve(existing);
    }
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`image download timeout: ${url}`)), IMAGE_DOWNLOAD_TIMEOUT);
    });
    const download = (async () => {
      const blob = await Container.get(IBasicRequestService).download(url);
      this.imageBlobCache.set(url, blob);
      return blob;
    })();
    return Promise.race([download, timeout]);
  };

  /**
   * Downloader used for the accessibility probe. Header-level simulation of
   * Notion's fetcher is unreliable (sites fingerprint the whole client), so
   * the probe goes through Notion's own image endpoint: it fetches the
   * source server-side and returns the image only when Notion can display
   * it. Errors and non-image responses count as blocked, so auto mode never
   * keeps an unverifiable image.
   */
  private probeDownload = (url: string): Promise<Blob> =>
    Container.get(IBasicRequestService).download(buildNotionProbeUrl(url));

  /** The user-configured image host, if any. Resolved lazily through the
   * backend context to avoid a circular import at module-evaluation time. */
  private getExternalImageService = async (): Promise<
    { uploadImageUrl(url: string): Promise<string> } | undefined
  > => {
    try {
      const backend = (await import('../../index')).default;
      return backend.getImageHostingService();
    } catch {
      return undefined;
    }
  };

  /**
   * Classify every image in the markdown and rehost the blocked ones.
   *
   * - `never`: keep all original URLs.
   * - `auto`: keep URLs that Notion's own image endpoint can actually fetch,
   *   rehost the rest. An unreachable/failed probe is counted as blocked so
   *   nothing unverified is kept.
   * - `always`: rehost everything.
   *
   * Rehosting to the user's image host rewrites the markdown directly;
   * rehosting to Notion requires the page to exist first, so those URLs are
   * returned for post-creation attachment.
   */
  private handleImages = async (
    markdown: string
  ): Promise<{ markdown: string; notionUploads: string[] }> => {
    if (this.imageHandling === 'never') {
      return { markdown, notionUploads: [] };
    }
    const urls = extractImageUrls(markdown);
    if (urls.length === 0) {
      return { markdown, notionUploads: [] };
    }

    let blocked: string[];
    if (this.imageHandling === 'always') {
      blocked = urls;
    } else {
      this.showImageProgress(
        'backend.services.notion.image.progress.probe',
        'Checking {count} image(s) against Notion…',
        { count: urls.length }
      );
      const accessibility = await probeImageAccessibility(urls, (url) => this.probeDownload(url));
      blocked = urls.filter((url) => !accessibility.get(url));
    }
    if (blocked.length === 0) {
      this.finishImageProgress(0);
      return { markdown, notionUploads: [] };
    }

    const externalService =
      this.rehostTarget === 'notion' ? undefined : await this.getExternalImageService();
    const preferExternal =
      (this.rehostTarget === 'imageHosting' || this.rehostTarget === 'auto') &&
      !!externalService;
    const externalOnly = this.rehostTarget === 'imageHosting';
    const allowNotionFallback = this.rehostTarget === 'auto' || this.rehostTarget === 'notion';

    const mapping = new Map<string, string>();
    const notionUploads: string[] = [];
    let failed = 0;
    let done = 0;
    const targetLabel =
      this.rehostTarget === 'notion' || !externalService ? 'Notion' : 'image host';
    for (const url of blocked) {
      this.showImageProgress(
        'backend.services.notion.image.progress.rehost',
        'Rehosting images to {target}: {done}/{total}…',
        { target: targetLabel, done, total: blocked.length }
      );
      if (preferExternal && externalService) {
        try {
          const hosted = await externalService.uploadImageUrl(url);
          if (hosted) {
            mapping.set(url, hosted);
            done++;
            continue;
          }
        } catch (error) {
          console.warn('[web-clipper] image host upload failed', url, error);
        }
        if (externalOnly) {
          failed++;
          continue; // Keep the original URL rather than uploading to Notion.
        }
      }
      if (allowNotionFallback) {
        notionUploads.push(url);
        done++;
      } else {
        failed++;
      }
    }
    if (notionUploads.length === 0) {
      this.finishImageProgress(failed);
    }
    return { markdown: replaceImageUrls(markdown, mapping), notionUploads };
  };

  /** Upload an image to Notion's File Upload API. Returns the file upload id
   * for attaching to a block, or null on failure. */
  private uploadImageToNotion = async (url: string): Promise<string | null> => {
    try {
      const blob = await this.downloadImage(url);
      const contentType = blob.type || 'image/jpeg';
      const filename = `clipper-${Date.now()}.${extensionForContentType(contentType)}`;
      const { data } = await this.request.post('/file_uploads', {
        mode: 'single_part',
        filename,
        content_type: contentType,
      });
      if (!data || !data.id || !data.upload_url) {
        return null;
      }
      const form = new FormData();
      form.append('file', blob, filename);
      // The upload URL is pre-signed: send it without the API auth headers.
      const uploadResponse = await fetch(data.upload_url, { method: 'POST', body: form });
      if (!uploadResponse.ok) {
        return null;
      }
      const result = await uploadResponse.json().catch(() => null);
      if (result && result.status && result.status !== 'uploaded') {
        return null;
      }
      return data.id as string;
    } catch {
      return null;
    }
  };

  /** Fetch every block of a page (paginated). */
  private getAllBlockChildren = async (pageId: string): Promise<any[]> => {
    const blocks: any[] = [];
    let cursor: string | null = null;
    do {
      const pageResponse: {
        data: { results: any[]; has_more: boolean; next_cursor: string | null };
      } = await this.request.get(
        `/blocks/${pageId}/children${cursor ? `?start_cursor=${cursor}` : ''}`
      );
      const data = pageResponse.data;
      blocks.push(...((data && data.results) || []));
      cursor = data && data.has_more ? data.next_cursor : null;
    } while (cursor);
    return blocks;
  };

  /** Recursively collect image blocks (Notion can nest them inside callouts,
   * toggles, columns, list items, …). */
  private collectImageBlocks = (blocks: any[], found: any[] = []): any[] => {
    blocks.forEach((block) => {
      if (block?.type === 'image') {
        found.push(block);
      }
      const children = block?.children;
      if (Array.isArray(children)) {
        this.collectImageBlocks(children, found);
      }
    });
    return found;
  };

  /** Compare URLs after normalizing encoding and trailing separators, so the
   * URL Notion stores still matches the one we sent in the markdown. */
  private normalizedImageUrl = (url: string): string => {
    try {
      return decodeURIComponent(url).trim().replace(/\/+$/, '');
    } catch {
      return (url || '').trim();
    }
  };

  /** Replace image blocks whose external URL is in `urls` with Notion-hosted
   * file uploads. Per-block failures are reported and the original external
   * URL is kept, so the page still exists if anything goes wrong. */
  private attachNotionUploads = async (pageId: string, urls: string[]): Promise<void> => {
    if (urls.length === 0) {
      return;
    }
    const pending = new Set(urls.map((url) => this.normalizedImageUrl(url)));
    let failed = 0;
    let done = 0;
    try {
      const blocks = await this.getAllBlockChildren(pageId);
      const images = this.collectImageBlocks(blocks).filter((block) => {
        const external = block?.image?.external?.url;
        return external && pending.has(this.normalizedImageUrl(external));
      });
      for (const block of images) {
        this.showImageProgress(
          'backend.services.notion.image.progress.notion',
          'Uploading images to Notion: {done}/{total}…',
          { done, total: images.length }
        );
        const externalUrl = block.image.external.url;
        const uploadId = await this.uploadImageToNotion(externalUrl);
        if (!uploadId) {
          failed++;
          console.warn('[web-clipper] Notion file upload failed for', externalUrl);
          continue;
        }
        try {
          await this.request.patch(`/blocks/${block.id}`, {
            image: { type: 'file_upload', file_upload: { id: uploadId } },
          });
          done++;
        } catch (error) {
          failed++;
          console.warn('[web-clipper] Notion image block patch failed for', externalUrl, error);
        }
      }
      failed += urls.length - images.length;
      if (images.length < urls.length) {
        console.warn(
          '[web-clipper] Notion image blocks not found for',
          urls.length - images.length,
          'image(s)'
        );
      }
    } catch (error) {
      failed += urls.length - done;
      console.warn('[web-clipper] failed to list Notion image blocks', error);
    }
    this.finishImageProgress(failed);
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

    // The clipper template starts with YAML frontmatter and repeats the title
    // in an H1. Notion understands neither as metadata, so split it out.
    const { meta, body: article } = parseFrontmatter(content);
    const cleanArticle = Object.keys(meta).length > 0 ? stripDuplicateHeading(article, safeTitle) : article;
    // Notion rejects inline, list-item and link-wrapped images; Obsidian does
    // not. Split them into standalone image blocks before sending.
    const normalizedArticle = normalizeImageBlocks(cleanArticle);

    // Bookmark clips wrap a tiny link stub. When the template has no explicit
    // category, classify them so the Category property stays accurate.
    if (!meta.category?.trim() && isBookmarkStub(cleanArticle)) {
      meta.category = CATEGORY_BOOKMARK;
    }

    const { schema, titleName } = await this.getParentProperties(repositoryId, objectType);
    const properties: Record<string, any> = {
      [titleName]: { title: [{ text: { content: safeTitle } }] },
    };
    let calloutMeta = meta;
    if (objectType !== 'page') {
      // In a database/data source the metadata becomes real, filterable fields.
      // Candidates are tried in order: exact name, then aliases. Read-only
      // properties (formulas, created_time, ...) are skipped so a frontmatter
      // key like `source` falls through to a writable `URL` property instead
      // of failing the whole request on the template's `Source` formula.
      const unmapped: Record<string, string> = {};
      Object.keys(meta).forEach((key) => {
        const value = (meta[key] || '').trim();
        if (!value) {
          return; // Nothing to write for an empty field.
        }
        const candidates = [key, ...(PROPERTY_ALIASES[key.toLowerCase()] || [])];
        for (const candidate of candidates) {
          const entry = Object.entries<any>(schema).find(
            ([name]) => normalizePropertyName(name) === normalizePropertyName(candidate)
          );
          if (!entry) {
            continue;
          }
          const [, definition] = entry;
          const type: string = definition?.type;
          if (type === 'title') {
            continue; // Already filled from the page title.
          }
          if (READ_ONLY_PROPERTY_TYPES.has(type)) {
            continue;
          }
          const propertyValue = this.toPropertyValue(type, value);
          if (propertyValue === undefined) {
            continue;
          }
          properties[entry[0]] = propertyValue;
          return;
        }
        // No writable property matched. `clipped` is covered by the database's
        // automatic `Created at` property; anything else goes to the callout.
        if (!AUTO_DATABASE_KEYS.has(key.toLowerCase())) {
          unmapped[key] = meta[key];
        }
      });
      calloutMeta = unmapped;
    }

    // Fields with no matching Notion property go into a native callout block
    // so no metadata is silently lost.
    const callout = buildCallout(calloutMeta);
    let markdown = [callout, normalizedArticle.trim()].filter(Boolean).join('\n\n') || safeTitle;

    // Notion loads external images through its own server-side proxy, so
    // URLs with anti-bot protection break. Probe them and rehost the blocked
    // ones (user's image host, or Notion's File Upload API) when enabled.
    this.imageBlobCache.clear();
    let notionUploads: string[] = [];
    try {
      const handled = await this.handleImages(markdown);
      markdown = handled.markdown;
      notionUploads = handled.notionUploads;
    } catch {
      // Keep the original markdown when the image pipeline fails.
    }

    const body: Record<string, any> = {
      parent,
      icon: { emoji: '📌' },
      markdown_version: 'v2',
      markdown,
      properties,
    };

    const { data } = await this.request.post<NotionCreatePageResponse>('/pages', body);
    if (notionUploads.length > 0 && data && data.id) {
      // Attached uploads live outside the critical path: a failure here
      // leaves the page with its original (already created) image blocks.
      await this.attachNotionUploads(data.id, notionUploads);
    }
    return {
      href: data.url || `https://www.notion.so/${data.id.replace(/-/g, '')}`,
    };
  };
}

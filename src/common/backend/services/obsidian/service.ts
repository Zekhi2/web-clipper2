import md5 from '@web-clipper/shared/lib/md5';
import copyToClipboard from 'copy-to-clipboard';
import { CreateDocumentRequest, DocumentService } from '../../index';
import { ObsidianFormConfig } from './interface';
import { sanitizeFilename } from './sanitizeFilename';
import QueryString from 'query-string';

/**
 * Some browsers and operating systems (especially Edge on Windows) strictly limit
 * the length of custom-protocol URIs (obsidian://) and fail silently when exceeded.
 * So we pass long content through the system clipboard instead, which is supported
 * by the `clipboard` parameter of `obsidian://new` since Obsidian 1.7.2.
 */
const MAX_URI_LENGTH = 1800;

export default class ObsidianService implements DocumentService {
  constructor(private config: ObsidianFormConfig) {}
  getId = () => {
    return md5(JSON.stringify(this.config));
  };

  getUserInfo = async () => {
    return {
      name: 'Obsidian',
      avatar: '',
      description: `Vault: ${this.config.vault}`,
    };
  };

  getRepositories = async () => {
    const folders = (this.config.folder || '').split('\n').map((folder) => {
      return {
        id: folder,
        name: folder,
        groupId: 'obsidian',
        groupName: this.config.vault,
      };
    });
    return folders;
  };

  createDocument = async (info: CreateDocumentRequest) => {
    const title = sanitizeFilename(info.title, this.config.sanitize);
    const file = `${info.repositoryId}/${title}`;
    const query = {
      silent: true,
      vault: this.config.vault,
      file,
    };
    const contentUrl = QueryString.stringifyUrl({
      url: 'obsidian://new',
      query: {
        ...query,
        content: info.content,
      },
    });
    if (contentUrl.length <= MAX_URI_LENGTH) {
      window.open(contentUrl);
    } else if (copyToClipboard(info.content)) {
      // `clipboard: null` is serialized as a bare `&clipboard` parameter.
      window.open(
        QueryString.stringifyUrl({
          url: 'obsidian://new',
          query: {
            ...query,
            clipboard: null,
          },
        })
      );
    } else {
      // Clipboard write failed, fall back to the URI (may fail silently on very long content).
      window.open(contentUrl);
    }
    return {
      href: QueryString.stringifyUrl({
        url: 'obsidian://open',
        query: {
          vault: this.config.vault,
          file,
        },
      }),
    };
  };
}

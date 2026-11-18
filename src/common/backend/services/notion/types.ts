import { Repository } from '../interface';

export interface NotionRepository extends Repository {
  /** Which official API endpoint to use as the parent of a clipped page. */
  notionObjectType: 'page' | 'database' | 'data_source';
}

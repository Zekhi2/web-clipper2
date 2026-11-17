import { FilenameSanitizeMode } from './sanitizeFilename';

export interface ObsidianFormConfig {
  vault: string;
  folder: string;
  sanitize?: FilenameSanitizeMode;
}

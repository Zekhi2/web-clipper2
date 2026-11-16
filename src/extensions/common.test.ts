import { describe, it, expect } from 'vitest';
import { getLocaleExtensionManifest } from './common';

describe('getLocaleExtensionManifest', () => {
  it('returns the locale specific manifest entries', () => {
    const manifest = {
      name: 'Link',
      version: '0.0.3',
      i18nManifest: {
        'zh-CN': { name: '添加模版' },
      },
    };
    const result = getLocaleExtensionManifest(manifest as any, 'zh-CN');
    expect(result.name).toBe('添加模版');
    expect(result.version).toBe('0.0.3');
  });

  it('does not throw for a missing manifest', () => {
    expect(() => getLocaleExtensionManifest(undefined as any, 'zh-CN')).not.toThrow();
    expect(getLocaleExtensionManifest(undefined as any, 'zh-CN')).toEqual({});
  });
});

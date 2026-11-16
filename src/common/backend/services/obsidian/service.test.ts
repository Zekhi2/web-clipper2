import { describe, it, expect, vi, beforeEach } from 'vitest';
import ObsidianService from './service';

const copyToClipboard = vi.fn((_text: string) => true);
vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => copyToClipboard(...(args as [string])),
}));

const open = vi.fn();
(global as any).window = { open };

const SHORT_CONTENT = '# Title\n\nshort content';
const LONG_CONTENT = 'a'.repeat(3000);

describe('ObsidianService', () => {
  beforeEach(() => {
    open.mockClear();
    copyToClipboard.mockClear();
    copyToClipboard.mockImplementation(() => true);
  });

  it('passes short content through the URI', async () => {
    const service = new ObsidianService({ vault: 'My Vault', folder: 'clip' });
    await service.createDocument({
      repositoryId: 'clip',
      title: 'Test',
      content: SHORT_CONTENT,
      tags: [],
      url: 'https://example.com',
    } as any);

    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url.startsWith('obsidian://new?')).toBe(true);
    expect(url).toContain('vault=My%20Vault');
    expect(url).toContain('content=');
    expect(url).not.toContain('clipboard');
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard for long content', async () => {
    const service = new ObsidianService({ vault: 'My Vault', folder: 'clip' });
    await service.createDocument({
      repositoryId: 'clip',
      title: 'Test',
      content: LONG_CONTENT,
      tags: [],
      url: 'https://example.com',
    } as any);

    expect(copyToClipboard).toHaveBeenCalledWith(LONG_CONTENT);
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url.startsWith('obsidian://new?')).toBe(true);
    expect(url).toMatch(/clipboard(&|$)/);
    expect(url).not.toContain('content=');
  });

  it('uses the URI when the clipboard write fails', async () => {
    copyToClipboard.mockImplementation(() => false);
    const service = new ObsidianService({ vault: 'My Vault', folder: 'clip' });
    await service.createDocument({
      repositoryId: 'clip',
      title: 'Test',
      content: LONG_CONTENT,
      tags: [],
      url: 'https://example.com',
    } as any);

    expect(copyToClipboard).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url).toContain('content=');
    expect(url).not.toContain('clipboard');
  });
});

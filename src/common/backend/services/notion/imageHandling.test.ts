import { describe, test, expect } from 'vitest';
import {
  SERVER_FETCH_USER_AGENT,
  extensionForContentType,
  extractImageUrls,
  isImageBlobAccessible,
  probeImageAccessibility,
  replaceImageUrls,
} from './imageHandling';

describe('imageHandling', () => {
  test('extractImageUrls collects unique http(s) image URLs in order', () => {
    const markdown = [
      '![a](https://cdn.example.com/a.jpg)',
      'text',
      '![b](https://cdn.example.com/b.png)',
      '![c](https://cdn.example.com/a.jpg)',
      '![data](data:image/png;base64,xxx)',
    ].join('\n');
    expect(extractImageUrls(markdown)).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.png',
    ]);
    expect(extractImageUrls('')).toEqual([]);
  });

  test('replaceImageUrls rewrites matching image markdown', () => {
    const markdown = '![a](https://cdn.example.com/a.jpg)\n\n![b](https://cdn.example.com/b.png)';
    const mapping = new Map([['https://cdn.example.com/a.jpg', 'https://host.example/x.jpg']]);
    expect(replaceImageUrls(markdown, mapping)).toBe(
      '![a](https://host.example/x.jpg)\n\n![b](https://cdn.example.com/b.png)'
    );
    expect(replaceImageUrls('plain text', new Map())).toBe('plain text');
  });

  test('isImageBlobAccessible requires an image content type', () => {
    const blob = (type?: string) => new Blob(['x'], type ? { type } : undefined);
    expect(isImageBlobAccessible(blob('image/jpeg'))).toBe(true);
    expect(isImageBlobAccessible(blob('IMAGE/PNG'))).toBe(true);
    expect(isImageBlobAccessible(blob('text/html'))).toBe(false);
    expect(isImageBlobAccessible(blob())).toBe(false);
    expect(isImageBlobAccessible(null)).toBe(false);
  });

  test('the simulated server identity is deliberately non-browser', () => {
    expect(SERVER_FETCH_USER_AGENT).not.toMatch(/^Mozilla/);
  });

  test('probeImageAccessibility classifies downloads and errors', async () => {
    const downloader = async (url: string): Promise<Blob> => {
      if (url.includes('broken')) {
        throw new Error('network error');
      }
      if (url.includes('antibot')) {
        return new Blob(['<html>'], { type: 'text/html' });
      }
      if (url.includes('gated')) {
        // Simulates the CDN's anti-bot rejection page.
        return new Blob(['<html>567</html>'], { type: 'text/html' });
      }
      return new Blob(['x'], { type: 'image/jpeg' });
    };
    const results = await probeImageAccessibility([
      'https://cdn.example.com/ok.jpg',
      'https://cdn.example.com/broken.jpg',
      'https://cdn.example.com/antibot.jpg',
      'https://pic1.zhimg.com/gated.jpg',
    ], downloader);
    expect(results.get('https://cdn.example.com/ok.jpg')).toBe(true);
    expect(results.get('https://cdn.example.com/broken.jpg')).toBe(false);
    expect(results.get('https://cdn.example.com/antibot.jpg')).toBe(false);
    expect(results.get('https://pic1.zhimg.com/gated.jpg')).toBe(false);
  });

  test('extensionForContentType maps MIME types to file extensions', () => {
    expect(extensionForContentType('image/png')).toBe('png');
    expect(extensionForContentType('image/jpeg; charset=binary')).toBe('jpg');
    expect(extensionForContentType('application/octet-stream')).toBe('jpg');
  });
});

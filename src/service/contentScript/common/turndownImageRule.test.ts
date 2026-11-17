import { describe, it, expect, beforeAll } from 'vitest';
import TurndownService from 'turndown';
import { overrideLazyLoadImageRule } from './turndownImageRule';

describe('overrideLazyLoadImageRule', () => {
  let turndown: (html: string) => string;

  beforeAll(() => {
    (global as any).window = {
      location: { protocol: 'https:', origin: 'https://example.com' },
    };
    const service = new TurndownService({ codeBlockStyle: 'fenced' });
    overrideLazyLoadImageRule(service);
    turndown = html => service.turndown(html);
  });

  it('keeps an image wrapped in a link on a single line', () => {
    const html = '<a href="https://www.pbs.org/wgbh/nova/"><img src="https://cdn.example.com/p.jpeg"></a>';
    expect(turndown(html)).toBe('[![](https://cdn.example.com/p.jpeg)](https://www.pbs.org/wgbh/nova/)');
  });

  it('does not introduce newlines when the source HTML is indented', () => {
    const html = [
      '<a href="https://www.pbs.org/wgbh/nova/">',
      '  <img src="https://cdn.example.com/p.jpeg">',
      '</a>',
    ].join('\n');
    const result = turndown(html);
    expect(result).toBe('[![](https://cdn.example.com/p.jpeg)](https://www.pbs.org/wgbh/nova/)');
    expect(result).not.toContain('\n');
  });

  it('restores the alt text', () => {
    expect(turndown('<img src="https://cdn.example.com/p.jpeg" alt="A photo">')).toBe(
      '![A photo](https://cdn.example.com/p.jpeg)'
    );
  });

  it('falls back to lazy-load attributes and keeps the alt text', () => {
    expect(turndown('<img data-src="/lazy.png" alt="lazy">')).toBe(
      '![lazy](https://example.com/lazy.png)'
    );
    expect(turndown('<img data-original-src="//cdn.example.com/o.png">')).toBe(
      '![](https://cdn.example.com/o.png)'
    );
  });

  it('prefers lazy-load attributes over src, which is often a placeholder', () => {
    expect(turndown('<img src="/placeholder.png" data-src="/real.png">')).toBe(
      '![](https://example.com/real.png)'
    );
  });

  it('returns nothing for images without a usable url', () => {
    expect(turndown('<img>')).toBe('');
  });
});

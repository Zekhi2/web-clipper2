import TurndownService from 'turndown';

/**
 * The `lazyLoadImage` rule bundled with @web-clipper/turndown emits every
 * image as `![](url)` followed by a newline. When the image is wrapped in a
 * link (`<a href><img></a>`, common for clickable thumbnails), that newline
 * ends up inside the link text (`[![](url)\n](href)`) and renders badly in
 * Obsidian. The bundled rule also drops the alt text. Re-adding a rule with
 * the same name replaces it (turndown resolves rules newest first): the
 * lazy-load attribute fallbacks and relative URL resolution are kept, the
 * alt text is restored and the trailing newline is removed.
 */
export const overrideLazyLoadImageRule = (turndownService: TurndownService): void => {
  const fixImageUrl = (url: string): string => {
    if (url.startsWith('//')) {
      return `${window.location.protocol}${url}`;
    }
    if (url.startsWith('/')) {
      return `${window.location.origin}${url}`;
    }
    return url;
  };

  turndownService.addRule('lazyLoadImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const attributes = ['data-src', 'data-original-src', 'src'];
      for (const attribute of attributes) {
        const url = node.getAttribute(attribute);
        if (url) {
          const alt = node.getAttribute('alt') || '';
          return `![${alt}](${fixImageUrl(url)})`;
        }
      }
      return '';
    },
  });
};

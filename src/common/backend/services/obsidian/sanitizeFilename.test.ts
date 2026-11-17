import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './sanitizeFilename';

describe('sanitizeFilename', () => {
  it('maps Windows-forbidden characters to fullwidth equivalents by default', () => {
    expect(sanitizeFilename('a:b/c|d*e?f"g<h>i\\j')).toBe('a：b／c｜d＊e？f＂g＜h＞i＼j');
  });

  it('maps wikilink-breaking characters to fullwidth equivalents', () => {
    expect(sanitizeFilename('note [1] #tag ^ref')).toBe('note ［1］ ＃tag ＾ref');
  });

  it('replaces forbidden characters with underscores in underscore mode', () => {
    expect(sanitizeFilename('a:b|c', 'underscore')).toBe('a_b_c');
  });

  it('keeps the raw title in off mode', () => {
    expect(sanitizeFilename('a:b|c', 'off')).toBe('a:b|c');
  });

  it('removes control characters in every mode', () => {
    expect(sanitizeFilename('a\u0000b\u001fc')).toBe('a b c');
  });

  it('strips leading and trailing dots and spaces', () => {
    expect(sanitizeFilename('  .title. . ')).toBe('title');
  });

  it('appends an underscore to reserved Windows device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('NUL.txt')).toBe('NUL.txt_');
    expect(sanitizeFilename('com1')).toBe('com1_');
    expect(sanitizeFilename('LPT3.md')).toBe('LPT3.md_');
  });

  it('does not touch names that merely resemble reserved names', () => {
    expect(sanitizeFilename('Console')).toBe('Console');
    expect(sanitizeFilename('COM10')).toBe('COM10');
  });

  it('falls back to a placeholder for empty or whitespace-only titles', () => {
    expect(sanitizeFilename('')).toBe('Untitled');
    expect(sanitizeFilename('   ')).toBe('Untitled');
  });

  it('keeps titles consisting only of replaced characters as valid names', () => {
    expect(sanitizeFilename(':::', 'underscore')).toBe('___');
    expect(sanitizeFilename(':::')).toBe('：：：');
  });

  it('caps the length at 250 characters', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeFilename(long).length).toBe(250);
  });

  it('trims again after length capping', () => {
    const long = `${'a'.repeat(249)}.`;
    const result = sanitizeFilename(long);
    expect(result.length).toBe(249);
    expect(result.endsWith('.')).toBe(false);
  });
});

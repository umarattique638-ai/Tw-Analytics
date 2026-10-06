import { describe, expect, it } from 'vitest';
import { hostAllowed, normalizeUrl } from '../src';

const href = (u: string) => normalizeUrl(u)?.href;

describe('normalizeUrl', () => {
  it('lowercases the host but keeps the path case', () => {
    expect(href('https://EXAMPLE.com/About')).toBe('https://example.com/About');
  });
  it('drops the fragment', () => expect(href('https://example.com/docs#install')).toBe('https://example.com/docs'));
  it('drops default ports, keeps others', () => {
    expect(href('https://example.com:443/x')).toBe('https://example.com/x');
    expect(href('http://example.com:80/x')).toBe('http://example.com/x');
    expect(href('http://example.com:8080/')).toBe('http://example.com:8080/');
  });
  it('treats trailing-slash variants as one page, but keeps the root slash', () => {
    expect(href('https://example.com/pricing/')).toBe('https://example.com/pricing');
    expect(href('https://example.com/pricing')).toBe('https://example.com/pricing');
    expect(href('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com/a/b///')!.path).toBe('/a/b');
  });
  it('removes a trailing dot from the host', () => expect(normalizeUrl('https://example.com./x')!.host).toBe('example.com'));
  it('never stores credentials typed into the URL', () => {
    expect(href('https://user:secret@example.com/x')).toBe('https://example.com/x');
  });
  it('keeps only allow-listed query keys, sorted', () => {
    expect(href('https://example.com/p?z=1&utm_source=x&a=2&ref=y')).toBe('https://example.com/p?ref=y&utm_source=x');
  });
  it('drops tokens, emails and click ids', () => {
    expect(href('https://example.com/p?token=abc&email=a@b.com&fbclid=1&gclid=2')).toBe('https://example.com/p');
  });
  it('is idempotent: normalising twice changes nothing', () => {
    for (const u of [
      'https://EXAMPLE.com:443/a/b/?z=1&utm_source=a%20b&ref=y#top',
      'http://example.com./x//',
      'https://user:pw@example.com:8443/p/?utm_campaign=x+y',
    ]) {
      const once = normalizeUrl(u)!;
      expect(normalizeUrl(once.href)!.href).toBe(once.href);
    }
  });
  it('refuses anything that is not an http(s) page URL', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/', 'file:///etc/passwd', 'not a url', '', '//example.com/x']) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });
  it('returns host and path parts', () => {
    const n = normalizeUrl('https://Blog.Example.com/post/1/?utm_source=x')!;
    expect([n.host, n.path]).toEqual(['blog.example.com', '/post/1']);
  });
});

describe('hostAllowed', () => {
  it('exact match, case-insensitive', () => {
    expect(hostAllowed('example.com', ['example.com'])).toBe(true);
    expect(hostAllowed('EXAMPLE.com', ['example.com'])).toBe(true);
    expect(hostAllowed('www.example.com', ['example.com'])).toBe(false);
  });
  it('a wildcard needs a real subdomain and never matches the apex', () => {
    expect(hostAllowed('a.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false);
  });
  it('lookalike hosts are refused', () => {
    expect(hostAllowed('badexample.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('example.com.evil.com', ['example.com', '*.example.com'])).toBe(false);
    expect(hostAllowed('evil.com', ['example.com'])).toBe(false);
  });
  it('an empty list, or a blank or bare-wildcard entry, allows nothing', () => {
    expect(hostAllowed('example.com', [])).toBe(false);
    expect(hostAllowed('example.com', ['', '  ', '*.'])).toBe(false);
  });
});
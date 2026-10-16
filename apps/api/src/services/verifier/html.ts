import type { FoundTag } from './types';

/** The value of attribute `name` in one HTML tag (any quoting), or null. */
export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Every <script src=".../tw.js"> in the HTML, with whether it sits in a comment or <noscript>. */
export function findSnippets(html: string, pageUrl: string): FoundTag[] {
  const hiddenRanges: { from: number; to: number; kind: 'comment' | 'noscript' }[] = [];
  for (const m of html.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) hiddenRanges.push({ from: m.index!, to: m.index! + m[0].length, kind: 'comment' });
  for (const m of html.matchAll(/<noscript\b[\s\S]*?(?:<\/noscript\s*>|$)/gi)) hiddenRanges.push({ from: m.index!, to: m.index! + m[0].length, kind: 'noscript' });
  // Text INSIDE a <script> element (a JS comment or string that mentions a snippet) is code, not a tag.
  const scriptBodies: { from: number; to: number }[] = [];
  for (const m of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)) {
    const from = m.index! + m[1]!.length;
    scriptBodies.push({ from, to: from + m[2]!.length });
  }
  const out: FoundTag[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (scriptBodies.some((b) => m.index! >= b.from && m.index! < b.to)) continue;
    const tag = m[0];
    const src = attr(tag, 'src');
    if (!src) continue;
    let url: URL;
    try {
      url = new URL(src, pageUrl);
    } catch {
      continue;
    }
    if (!/\/tw\.js$/.test(url.pathname)) continue;
    const hidden = hiddenRanges.find((r) => m.index! >= r.from && m.index! < r.to)?.kind ?? null;
    out.push({ src: url.href, key: url.searchParams.get('id') || attr(tag, 'data-id'), api: attr(tag, 'data-api'), hidden });
  }
  return out;
}

import { FLAG_UA_MISMATCH } from '@tailwatch/contract';
import type { ClientHints } from '@tailwatch/contract';

/**
 * Headless / automation scoring (Stage 7, PLAN 2.4). What the request says, compared with what a real
 * browser of the claimed kind would send, plus the tracker's own A6 flag.
 *
 * STRONG (one is enough): things no person's browser does.
 *   ch_headless     Sec-CH-UA names a headless brand ("HeadlessChrome"). Playwright keeps it even when the
 *                   User-Agent is spoofed.
 *   js_ua_mismatch  the tracker saw navigator.userAgentData with NO brands or a headless brand
 *                   (FLAG_UA_MISMATCH): Puppeteer's page.setUserAgent() leaves exactly that, and sends no
 *                   client hints at all, so without it a spoofed "Safari" looks clean.
 *
 * UA-vs-hints contradictions (ONE weak signal together, however many fire): a UA-switcher extension or
 * a "view desktop site" mode does exactly this for real people, so on its own it is never enough.
 *   ch_engine       Sec-CH-UA sent, but the UA claims Firefox, Safari or iOS.
 *   ch_version      UA "Chrome/126" but Sec-CH-UA "Chromium";v="141".
 *   ch_platform     UA says Windows, Sec-CH-UA-Platform says "Linux" (known platforms only).
 *   ch_mobile       Sec-CH-UA-Mobile ?1 with a desktop UA.
 *
 * WEAK (two needed, the contradiction family counting as one):
 *   no_lang         no Accept-Language (every real browser sends one with every request).
 *   ch_missing      a modern Chrome UA over HTTPS without any Sec-CH-UA (not a WebView).
 *   generic_bot_token  bots.yml's catch-all "Generic Bot" pattern matched a UA that otherwise is a normal
 *                   browser (tokens like "security", "monitor", "proxy" appear in enterprise browsers).
 *
 * Tolerated on purpose (real people): Android "Request desktop site" (any desktop UA with platform
 * Android and ?0), WebViews (no hints), unknown platform strings (BSD, "Chromium OS" = Chrome OS), and
 * an 800 px window (Samsung tablets in portrait; it was a Puppeteer-default signal, removed after review).
 */

export interface HeadlessInput {
  userAgent?: string;
  width?: number;
  hints?: ClientHints;
  flags?: number;
  /** Extra weak signals from elsewhere (generic_bot_token from the bots.yml pass). */
  extraWeak?: string[];
}

export interface HeadlessScore {
  strong: string[];
  /** UA-vs-hints contradictions: together they count as ONE weak signal. */
  contradictions: string[];
  weak: string[];
}

interface Brand {
  brand: string;
  version: number;
}

export function parseBrands(header: string): Brand[] {
  const out: Brand[] = [];
  for (const m of header.matchAll(/"([^"]*)"\s*;\s*v\s*=\s*"?(\d+)/g)) out.push({ brand: m[1]!, version: Number(m[2]) });
  return out;
}

const unquote = (v: string | undefined) => (v ?? '').trim().replace(/^"|"$/g, '');

const KNOWN_PLATFORMS: ReadonlySet<string> = new Set(['Windows', 'macOS', 'Android', 'iOS', 'Chrome OS', 'Linux']);
const normalisePlatform = (p: string) => (p === 'Chromium OS' || p === 'ChromeOS' ? 'Chrome OS' : p);

/** What OS the User-Agent claims, in Sec-CH-UA-Platform's vocabulary. '' = unknown. */
function uaPlatform(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'Chrome OS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/BSD/i.test(ua)) return '';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return '';
}

/** Never sends client hints: Firefox, Safari, anything on iOS (all WebKit). */
const nonChromium = (ua: string) =>
  /iPhone|iPad|iPod/.test(ua) || /Firefox\//.test(ua) || (/Safari\//.test(ua) && /Version\/[\d.]+/.test(ua) && !/Chrome\/|Chromium\//.test(ua));

const isWebView = (ua: string) => /; wv\)/.test(ua) || /Version\/4\.0 Chrome\//.test(ua);

export function headlessScore(input: HeadlessInput): HeadlessScore {
  const strong: string[] = [];
  const contradictions: string[] = [];
  const weak: string[] = [...(input.extraWeak ?? [])];
  const ua = input.userAgent ?? '';
  const h = input.hints;
  const chromeMajor = Number(ua.match(/(?:^|[^A-Za-z])Chrome\/(\d+)/)?.[1] ?? NaN);

  if (h?.chUa !== undefined) {
    const brands = parseBrands(h.chUa);
    if (brands.some((b) => /headless/i.test(b.brand))) strong.push('ch_headless');
    if (nonChromium(ua)) contradictions.push('ch_engine');
    const chromium = brands.find((b) => b.brand === 'Chromium');
    if (chromium && Number.isFinite(chromeMajor) && chromium.version !== chromeMajor) contradictions.push('ch_version');

    const claimed = uaPlatform(ua);
    const reported = normalisePlatform(unquote(h.chPlatform));
    // Android "Request desktop site" / "View desktop site": the UA turns into a desktop one (Linux for
    // Chrome, Windows for Edge), the platform hint stays Android and mobile goes to ?0.
    const desktopMode = reported === 'Android' && h.chMobile !== '?1';
    if (KNOWN_PLATFORMS.has(claimed) && KNOWN_PLATFORMS.has(reported) && claimed !== reported && !desktopMode) contradictions.push('ch_platform');

    if (h.chMobile === '?1' && !/Mobi|Android|iPhone|iPod/.test(ua)) contradictions.push('ch_mobile');
  } else if (h?.https && chromeMajor >= 90 && !isWebView(ua) && !nonChromium(ua)) {
    weak.push('ch_missing');
  }

  if (((input.flags ?? 0) & FLAG_UA_MISMATCH) !== 0) strong.push('js_ua_mismatch');
  if (h && !h.lang) weak.push('no_lang');
  return { strong, contradictions, weak };
}

/** The drop detail (`headless:ch_headless+ch_version`), or null when it looks like a person. */
export function headlessVerdict(input: HeadlessInput): string | null {
  const { strong, contradictions, weak } = headlessScore(input);
  const all = [...strong, ...contradictions, ...weak];
  if (strong.length > 0) return `headless:${all.join('+')}`;
  if ((contradictions.length > 0 ? 1 : 0) + weak.length >= 2) return `headless:${all.join('+')}`;
  return null;
}

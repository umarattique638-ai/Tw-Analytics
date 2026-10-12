/**
 * Snippet generator (BUILD-ORDER Part 1 ③). The ONLY place snippets are written: the dashboard, the
 * WordPress plugin and the mobile app all show what this returns (one backend, one source of truth).
 *
 * Owner decision 2026-10-12: one install method for everyone, the script tag pasted into <head>
 * (it works on any site and tracks single-page apps by itself), plus copy-ready code for custom events.
 * The npm / framework packages still exist in the repo (packages/*) but are not offered here.
 */
export type InstallGroup = 'script-tag' | 'custom-event';

export interface Snippet {
  id: string;
  group: InstallGroup;
  label: string;
  /** For syntax hints in clients. */
  language: 'html';
  code: string;
  note?: string;
  availability: 'now';
}

/** The queue stub: tw() can be called at any time, even before tw.js has loaded (packages/browser/src/cdn.ts). */
export const TW_STUB = '<script>window.tw=window.tw||function(){(tw.q=tw.q||[]).push(arguments)}</script>';

export function snippetsFor(collector: string, key: string): Snippet[] {
  const base = collector.replace(/\/+$/, '');
  const tag = `<script async fetchpriority="low" src="${base}/tw.js?id=${key}"></script>`;
  return [
    {
      id: 'script-tag',
      group: 'script-tag',
      label: 'Script tag',
      language: 'html',
      code: tag,
      note: 'Paste it inside <head> on every page (in most sites: once, in the layout or theme header). Page views, including single-page app navigation, are tracked automatically.',
      availability: 'now',
    },
    {
      id: 'custom-event',
      group: 'custom-event',
      label: 'Custom events',
      language: 'html',
      code:
        `<!-- 1. Once, in <head>, right below the TailWatch script: makes tw() safe to call at any time -->\n${TW_STUB}\n\n` +
        `<!-- 2a. Count clicks on a button or link -->\n<button onclick="tw('track', 'signup_click')">Sign up</button>\n\n` +
        `<!-- 2b. Or from your own JavaScript, with details -->\n<script>\n  tw('track', 'purchase', { plan: 'pro', amount: 49 });\n</script>`,
      note:
        'Event names: lowercase letters, digits and _ (up to 40), not starting with tw_. Up to 25 details per event (text, numbers or true/false). ' +
        'Never send personal data such as e-mail addresses or phone numbers. A new event shows up on the Events page with its first hit; nothing to register.',
      availability: 'now',
    },
  ];
}

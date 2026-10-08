/**
 * Snippet generator (BUILD-ORDER Part 1 ③). The ONLY place snippets are written: the dashboard, the
 * WordPress plugin and the mobile app all show what this returns (one backend, one source of truth).
 */
export type InstallGroup = 'script-tag' | 'npm' | 'framework' | 'wordpress';

export interface Snippet {
  id: string;
  group: InstallGroup;
  label: string;
  /** For syntax hints in clients. */
  language: 'html' | 'shell+js' | 'shell+tsx' | 'shell+ts' | 'shell+svelte' | 'text';
  code: string;
  note?: string;
  /** 'soon' = the package is not on the public npm registry yet (published before launch). */
  availability: 'now' | 'soon';
}

export function snippetsFor(collector: string, key: string): Snippet[] {
  const base = collector.replace(/\/+$/, '');
  const api = `${base}/e`;
  const npmNote = 'The npm packages are published before public launch. Until then, use the script tag.';
  return [
    {
      id: 'script-tag',
      group: 'script-tag',
      label: 'Script tag',
      language: 'html',
      code: `<script async fetchpriority="low" src="${base}/tw.js?id=${key}"></script>`,
      note: 'Paste it inside <head> on every page. Works on any site. Single-page apps are tracked automatically.',
      availability: 'now',
    },
    {
      id: 'npm',
      group: 'npm',
      label: 'npm package',
      language: 'shell+js',
      code: `npm i @tailwatch/browser\n\nimport { init } from '@tailwatch/browser';\n\ninit({ key: '${key}', api: '${api}' });`,
      note: npmNote,
      availability: 'soon',
    },
    {
      id: 'next',
      group: 'framework',
      label: 'Next.js',
      language: 'shell+tsx',
      code:
        `npm i @tailwatch/next\n\n// app/layout.tsx\nimport { TailwatchProvider } from '@tailwatch/next';\n\n` +
        `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>\n` +
        `        <TailwatchProvider siteKey="${key}" api="${api}">{children}</TailwatchProvider>\n      </body>\n    </html>\n  );\n}`,
      note: npmNote,
      availability: 'soon',
    },
    {
      id: 'react',
      group: 'framework',
      label: 'React',
      language: 'shell+tsx',
      code:
        `npm i @tailwatch/react\n\n// main.tsx\nimport { TailwatchProvider } from '@tailwatch/react';\n\n` +
        `createRoot(document.getElementById('root')!).render(\n  <TailwatchProvider siteKey="${key}" api="${api}">\n    <App />\n  </TailwatchProvider>,\n);`,
      note: npmNote,
      availability: 'soon',
    },
    {
      id: 'vue',
      group: 'framework',
      label: 'Vue',
      language: 'shell+ts',
      code:
        `npm i @tailwatch/vue\n\n// main.ts\nimport { TailWatch } from '@tailwatch/vue';\n\n` +
        `createApp(App)\n  .use(router)\n  .use(TailWatch, { key: '${key}', api: '${api}' }) // add hashRouting: true for createWebHashHistory\n  .mount('#app');`,
      note: npmNote,
      availability: 'soon',
    },
    {
      id: 'svelte',
      group: 'framework',
      label: 'Svelte',
      language: 'shell+svelte',
      code: `npm i @tailwatch/svelte\n\n<!-- src/routes/+layout.svelte -->\n<script>\n  import { tailwatch } from '@tailwatch/svelte';\n  tailwatch({ key: '${key}', api: '${api}' });\n</script>\n\n<slot />`,
      note: npmNote,
      availability: 'soon',
    },
    {
      id: 'wordpress',
      group: 'wordpress',
      label: 'WordPress',
      language: 'text',
      code:
        `The TailWatch WordPress plugin arrives in a later release.\n\nUntil then, add the script tag to your theme's <head>:\n` +
        `use a "header and footer scripts" plugin, or Appearance > Theme File Editor > header.php, and paste:\n\n` +
        `<script async fetchpriority="low" src="${base}/tw.js?id=${key}"></script>`,
      availability: 'now',
    },
  ];
}

import { CONTRACT_VERSION } from '@tailwatch/contract';

// Stage 0 hello world. The real collector (POST /e) is Stage 2.
export default {
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/health') return new Response('ok', { headers: { 'x-tw-contract': String(CONTRACT_VERSION) } });
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler;

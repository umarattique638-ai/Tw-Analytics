// TailWatch site doctor: why is a site not tracking?
// Run from the TailWatch root folder (it reads .env there):
//   node site-doctor.mjs https://kiln-shop.umarattique638.workers.dev
// Read-only: it changes nothing. Secrets from .env are used, never printed.
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const shop = (process.argv[2] || 'https://kiln-shop.umarattique638.workers.dev').replace(/\/+$/, '') + '/';
const host = new URL(shop).hostname;
const ok = (s) => console.log(`  OK    ${s}`);
const bad = (s) => console.log(`  FAIL  ${s}`);
const info = (s) => console.log(`        ${s}`);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

console.log(`\nSite: ${shop}\n\n1. The page`);
let key = null;
let collector = null;
try {
  const res = await fetch(shop, { headers: { 'user-agent': UA, 'cache-control': 'no-cache' } });
  const html = await res.text();
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*\/tw\.js[^"]*)"[^>]*>/gi)].map((m) => m[1]);
  if (res.ok) ok(`page loads (HTTP ${res.status})`);
  else bad(`page returned HTTP ${res.status}`);
  if (tags.length === 0) bad('no tw.js script tag in the live page: deploy again');
  else {
    if (tags.length > 1) bad(`${tags.length} tw.js script tags (should be 1)`);
    const src = new URL(tags[0]);
    key = src.searchParams.get('id');
    collector = src.origin;
    ok(`tw.js tag found, key ${key}`);
    if (!key || key.includes('PASTE')) bad('the key is still the placeholder');
  }
} catch (e) {
  bad(`cannot open the page: ${e.message}`);
}
if (!key) process.exit(1);

console.log('\n2. The tracker script');
try {
  const res = await fetch(`${collector}/tw.js?id=${key}`, { headers: { 'user-agent': UA } });
  const body = await res.text();
  if (res.ok && body.includes('use strict')) ok(`${collector}/tw.js loads (HTTP ${res.status}, ${body.length} bytes)`);
  else bad(`${collector}/tw.js returned HTTP ${res.status}`);
} catch (e) {
  bad(`cannot load tw.js: ${e.message}`);
}

console.log('\n3. The site key in Cloudflare KV (what the collector checks)');
let siteId = null;
const { CF_ACCOUNT_ID: acc, CF_KV_NAMESPACE_ID: ns, CF_API_TOKEN: token } = env;
if (!acc || !ns || !token) bad('CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN missing in .env: skipped');
else {
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(`site:${key}`)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 404) {
      bad('this key is NOT in KV: the collector treats every hit as "unknown site" and drops it.');
      info('Fix: dashboard -> this site -> Settings -> "Retry activation" (or use the key the dashboard shows).');
    } else if (!res.ok) bad(`KV read failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    else {
      const cfg = JSON.parse(await res.text());
      siteId = cfg.id;
      ok(`key is in KV -> site id ${cfg.id}`);
      (cfg.live ? ok : bad)(`live: ${cfg.live}${cfg.live ? '' : ' (site is paused or not active)'}`);
      (cfg.region === 'in' ? ok : bad)(`region: ${cfg.region} (the collector serves "in")`);
      (cfg.identitySecret ? ok : bad)(`identity secret ${cfg.identitySecret ? 'present' : 'MISSING (every hit is dropped as identity_unavailable)'}`);
      const hosts = cfg.allowedHosts ?? [];
      const allowed = hosts.some((a) => {
        const x = String(a).trim().toLowerCase();
        return x.startsWith('*.') ? host.endsWith(x.slice(1)) && host.length > x.length - 1 : x === host;
      });
      (allowed ? ok : bad)(`allowed hosts: ${JSON.stringify(hosts)} ${allowed ? `includes ${host}` : `do NOT include ${host} (hits dropped as "hostname")`}`);
    }
  } catch (e) {
    bad(`KV read failed: ${e.message}`);
  }
}

console.log('\n4. What reached ClickHouse (last 24 hours)');
const chUrl = env.TW_CH_URL;
const chUser = env.TW_CH_USER || 'default';
const chPass = env.TW_CH_PASSWORD;
if (!chUrl || !chPass) bad('TW_CH_URL / TW_CH_PASSWORD missing in .env: skipped');
else {
  const q = async (sql, params = {}) => {
    const u = new URL(chUrl);
    u.searchParams.set('default_format', 'JSON');
    u.searchParams.set('database', 'tailwatch');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(`param_${k}`, String(v));
    const res = await fetch(u, {
      method: 'POST',
      body: sql,
      headers: { authorization: `Basic ${Buffer.from(`${chUser}:${chPass}`).toString('base64')}` },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text).data;
  };
  try {
    const byHost = await q(
      `SELECT site_id, name, count() AS n, max(received_at) AS last
       FROM events WHERE hostname = {h:String} AND received_at > now() - INTERVAL 1 DAY
       GROUP BY site_id, name ORDER BY site_id, n DESC`,
      { h: host },
    );
    if (byHost.length === 0) bad(`no events at all with hostname ${host}`);
    for (const r of byHost) {
      const mark = siteId === null || Number(r.site_id) === Number(siteId) ? ok : bad;
      mark(`site ${r.site_id}: ${r.n} x ${r.name}, last at ${r.last} UTC${siteId !== null && Number(r.site_id) !== Number(siteId) ? '  <- a DIFFERENT site id than the key in KV' : ''}`);
    }
    if (siteId !== null) {
      const drops = await q(
        `SELECT reason, detail, sum(hits) AS hits, max(at) AS last
         FROM dropped_hits WHERE site_id = {s:UInt64} AND at > now() - INTERVAL 1 DAY
         GROUP BY reason, detail ORDER BY hits DESC LIMIT 15`,
        { s: siteId },
      );
      if (drops.length === 0) info(`no dropped hits for site ${siteId}`);
      for (const d of drops) bad(`dropped: ${d.hits} x ${d.reason}${d.detail ? `:${d.detail}` : ''} (last ${d.last} UTC)`);
      const all = await q(
        `SELECT count() AS n, max(received_at) AS last FROM events WHERE site_id = {s:UInt64} AND received_at > now() - INTERVAL 1 DAY`,
        { s: siteId },
      );
      info(`site ${siteId}: ${all[0].n} events in total in the last 24 h (last ${all[0].last} UTC)`);
    }
  } catch (e) {
    bad(`ClickHouse query failed: ${e.message} (service asleep? run again)`);
  }
}
console.log('\nDone. Send this whole output.\n');

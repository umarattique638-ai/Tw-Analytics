/** CSP source-list check for one directive (falls back to default-src). Null = no policy, allowed. */
export function cspAllows(policies: string[], directive: 'script-src' | 'connect-src', target: string, pageOrigin: string): boolean {
  const t = new URL(target);
  for (const policy of policies) {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(';')) {
      const [name, ...values] = part.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values);
    }
    const list = directives.get(directive) ?? directives.get('default-src');
    if (!list) continue;
    const ok = list.some((raw) => {
      const s = raw.replace(/^['"]|['"]$/g, '').toLowerCase();
      if (s === '*') return t.protocol === 'https:' || t.protocol === 'http:';
      if (s === 'self') return t.origin === pageOrigin;
      if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return t.protocol === s;
      const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/.exec(s);
      if (!m) return false;
      const [, scheme, wild, host, port] = m;
      if (scheme && `${scheme}:` !== t.protocol) return false;
      if (!scheme && t.protocol !== 'https:' && !(t.protocol === 'http:' && new URL(pageOrigin).protocol === 'http:')) return false;
      const hostOk = wild ? t.hostname.endsWith(`.${host}`) : t.hostname === host;
      const portOk = !port || port === '*' || port === (t.port || (t.protocol === 'https:' ? '443' : '80'));
      return hostOk && portOk;
    });
    if (!ok) return false; // every policy must allow it
  }
  return true;
}

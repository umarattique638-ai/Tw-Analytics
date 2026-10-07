import { describe, expect, it } from 'vitest';
import { edgeBotReason } from '../src';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

describe('edgeBotReason', () => {
  it('lets a normal browser through', () => {
    expect(edgeBotReason(CHROME)).toBeNull();
    expect(edgeBotReason(CHROME, 13335)).toBeNull(); // a non-datacentre ASN
  });
  it('a missing or empty user agent is a bot', () => {
    expect(edgeBotReason(null)).toEqual({ reason: 'bot', detail: 'missing_user_agent' });
    expect(edgeBotReason('')).toEqual({ reason: 'bot', detail: 'missing_user_agent' });
  });
  it('our own verifier is recognised on its own reason, never counted as a visitor', () => {
    expect(edgeBotReason('TailwatchVerifier/1.0')).toEqual({ reason: 'verification_agent', detail: 'install_check' });
  });
  it('scripting libraries and headless browsers are bots', () => {
    for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'Go-http-client/1.1', CHROME.replace('Chrome', 'HeadlessChrome')]) {
      expect(edgeBotReason(ua)?.reason, ua).toBe('bot');
    }
  });
  it('declared crawlers are bots', () => {
    expect(edgeBotReason('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')?.reason).toBe('bot');
    expect(edgeBotReason('Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0)')?.reason).toBe('bot');
  });
  it('a datacentre ASN is a bot even with a normal browser user agent', () => {
    expect(edgeBotReason(CHROME, 14061)).toEqual({ reason: 'bot', detail: 'datacentre_asn:14061' });
  });
  it('an unknown ASN, or no ASN at all, is not enough to drop', () => {
    expect(edgeBotReason(CHROME, 64512)).toBeNull();
    expect(edgeBotReason(CHROME, undefined)).toBeNull();
  });
  it('only UNAMBIGUOUS cases are dropped: "curl" in the middle of a real browser UA is not matched', () => {
    expect(edgeBotReason(`${CHROME} curl/8.0`)).toBeNull();
  });
});
describe('runtime default User-Agents are edge bots (found by the Stage 2 workerd test)', () => {
  for (const ua of ['undici', 'node', 'Deno/2.1.0', 'Bun/1.1.0', 'okhttp/4.12.0', 'Java/17.0.2', 'Apache-HttpClient/4.5.14 (Java/17)']) {
    it(ua, () => expect(edgeBotReason(ua)?.reason).toBe('bot'));
  }
  it('a browser that merely mentions node in its UA is not caught', () => {
    expect(edgeBotReason('Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 node')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const call = (path: string) => worker.fetch(new Request(`https://in.tailwatch.com${path}`) as never);

describe('collector hello world (Stage 0)', () => {
  it('GET /health answers ok and proves the contract package is wired in', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('x-tw-contract')).toBe('1');
  });
  it('anything else is 404', async () => {
    expect((await call('/nope')).status).toBe(404);
  });
});

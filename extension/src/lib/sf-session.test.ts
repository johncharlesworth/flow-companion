import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { readSession } from './sf-session';

function mockCookie(value: string | null) {
  const get = vi.fn(async () => (value === null ? null : { name: 'sid', value }));
  fakeBrowser.cookies.get = get as unknown as typeof fakeBrowser.cookies.get;
  return get;
}

describe('readSession', () => {
  it('reads the sid cookie for the Tooling host and decodes the org id', async () => {
    const get = mockCookie('00DXXXXXXXXXXXX!opaqueSessionToken');
    const session = await readSession('mycompany.my.salesforce.com');
    expect(session).toEqual({
      sfHost: 'mycompany.my.salesforce.com',
      sid: '00DXXXXXXXXXXXX!opaqueSessionToken',
      orgId: '00DXXXXXXXXXXXX',
    });
    expect(get).toHaveBeenCalledWith({ url: 'https://mycompany.my.salesforce.com', name: 'sid' });
  });

  it('returns null when there is no sid cookie', async () => {
    mockCookie(null);
    expect(await readSession('mycompany.my.salesforce.com')).toBeNull();
  });

  it('refuses to look up a cookie for anything but a Tooling host (invariant 3)', async () => {
    const get = mockCookie('00DXXXXXXXXXXXX!opaqueSessionToken');
    expect(await readSession('mycompany.lightning.force.com')).toBeNull();
    expect(await readSession('attacker.com.my.salesforce.com.evil')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

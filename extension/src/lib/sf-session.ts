// Reads the Salesforce session for a Tooling host from the browser's cookie
// jar. The value is used only as the Bearer token for that same host
// (invariant 3) and is never stored, rendered, or logged.

import { browser } from 'wxt/browser';

import { decodeOrgIdFromCookie, isToolingHost } from './sf-host';

export interface SfSession {
  sfHost: string;
  sid: string;
  orgId: string | null;
}

export async function readSession(sfHost: string): Promise<SfSession | null> {
  if (!isToolingHost(sfHost)) return null;
  const cookie = await browser.cookies.get({ url: `https://${sfHost}`, name: 'sid' });
  if (!cookie?.value) return null;
  return { sfHost, sid: cookie.value, orgId: decodeOrgIdFromCookie(cookie.value) };
}

// Salesforce host handling for the side panel. Ported from the earlier build
// background/sf-host.ts and messages.ts with the Setup-domain
// tabs (*.my.salesforce-setup.com) map to the My-Domain host for the cookie
// lookup and the Tooling API, exactly like Lightning tabs do. The strict
// validation and its reject vectors come from the retired worker.
//
// Invariant 3: the session cookie only ever goes to a host that passes
// isToolingHost. Nothing here handles .mcas.ms (documented limitation).

const SALESFORCE_TAB_HOST_RE = /\.(my\.salesforce\.com|my\.salesforce-setup\.com|lightning\.force\.com)$/i;
const TOOLING_SUFFIX = '.my.salesforce.com';
const LABEL_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i;

/** True for the three tab-host shapes the extension has host permissions for. */
export function isSalesforceHost(host: string): boolean {
  return SALESFORCE_TAB_HOST_RE.test(host);
}

/**
 * Strict check for the host the Tooling API is called on: a well-formed
 * tenant prefix followed by exactly `.my.salesforce.com`, with no port, path,
 * credentials, or query fragments.
 */
export function isToolingHost(host: string): boolean {
  if (!host) return false;
  if (/[:/@?#]/.test(host)) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.toLowerCase().endsWith(TOOLING_SUFFIX)) return false;
  const prefix = host.slice(0, host.length - TOOLING_SUFFIX.length);
  return LABEL_RE.test(prefix);
}

/**
 * Maps a Salesforce tab host to the My-Domain host that holds the session
 * cookie and serves the Tooling API, or null when the tab is not Salesforce.
 *
 *   mycompany.lightning.force.com                 -> mycompany.my.salesforce.com
 *   mycompany.my.salesforce-setup.com             -> mycompany.my.salesforce.com
 *   mycompany--sandbox.sandbox.lightning.force.com -> mycompany--sandbox.sandbox.my.salesforce.com
 */
export function toToolingHost(tabHost: string): string | null {
  const mapped = tabHost
    .replace(/\.lightning\.force\.com$/i, TOOLING_SUFFIX)
    .replace(/\.my\.salesforce-setup\.com$/i, TOOLING_SUFFIX);
  return isToolingHost(mapped) ? mapped.toLowerCase() : null;
}

/** The org id is the part of the sid cookie before the "!". */
export function decodeOrgIdFromCookie(cookieValue: string): string | null {
  if (!cookieValue || !cookieValue.includes('!')) return null;
  const orgId = cookieValue.split('!')[0];
  return orgId && orgId.length > 0 ? orgId : null;
}

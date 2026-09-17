import { describe, expect, it } from 'vitest';

import { decodeOrgIdFromCookie, isSalesforceHost, isToolingHost, toToolingHost } from './sf-host';

describe('isSalesforceHost', () => {
  it.each([
    'mycompany.my.salesforce.com',
    'mycompany.my.salesforce-setup.com',
    'mycompany.lightning.force.com',
    'mycompany--sandbox.sandbox.lightning.force.com',
  ])('accepts %s', (host) => {
    expect(isSalesforceHost(host)).toBe(true);
  });

  it.each(['example.com', 'login.salesforce.com', 'community.force.com', 'mycompany.my.salesforce.com.evil'])(
    'rejects %s',
    (host) => {
      expect(isSalesforceHost(host)).toBe(false);
    },
  );
});

describe('toToolingHost', () => {
  it('rewrites lightning.force.com host to my.salesforce.com', () => {
    expect(toToolingHost('mycompany.lightning.force.com')).toBe('mycompany.my.salesforce.com');
  });

  it('rewrites the Setup domain to my.salesforce.com (the cookie and the Tooling API live there)', () => {
    expect(toToolingHost('mycompany.my.salesforce-setup.com')).toBe('mycompany.my.salesforce.com');
  });

  it('rewrites sandbox lightning host correctly', () => {
    expect(toToolingHost('mycompany--sandbox.sandbox.lightning.force.com')).toBe(
      'mycompany--sandbox.sandbox.my.salesforce.com',
    );
  });

  it('passes through already-my-domain hosts unchanged', () => {
    expect(toToolingHost('mycompany.my.salesforce.com')).toBe('mycompany.my.salesforce.com');
  });

  it('lower-cases the result so cookie lookups and history keys are stable', () => {
    expect(toToolingHost('MyCompany.Lightning.Force.com')).toBe('mycompany.my.salesforce.com');
  });

  it.each(['example.com', 'community.force.com', 'attacker.com.my.salesforce.com.evil', 'mycompany.mcas.ms'])(
    'returns null for %s',
    (host) => {
      expect(toToolingHost(host)).toBeNull();
    },
  );
});

describe('isToolingHost — accept vectors', () => {
  it.each([
    'mycompany.my.salesforce.com',
    'mycompany--sandbox.my.salesforce.com',
    'mycompany--sandbox.sandbox.my.salesforce.com',
    'mycompany--scratch.scratch.my.salesforce.com',
  ])('accepts %s', (host) => {
    expect(isToolingHost(host)).toBe(true);
  });
});

describe('isToolingHost — reject vectors (the retired worker\'s 20, plus the Setup domain)', () => {
  it.each([
    '',
    'evil.example',
    'localhost',
    '127.0.0.1',
    '1.2.3.4',
    '[::1]',
    '::1',
    'mycompany.my.salesforce.com:8080',
    'mycompany.my.salesforce.com/path',
    'mycompany.my.salesforce.com?query=1',
    'user:pass@mycompany.my.salesforce.com',
    'attacker.com.my.salesforce.com.evil',
    'community.force.com',
    'mycompany.lightning.force.com',
    'customsite.salesforce.com',
    'mysite.cloudforce.com',
    'login.salesforce.com',
    'test.salesforce.com',
    '.my.salesforce.com', // suffix alone
    'my.salesforce.com', // missing tenant
    // The Setup domain is a tab host, not a Tooling host; toToolingHost maps it first.
    'mycompany.my.salesforce-setup.com',
  ])('rejects %s', (host) => {
    expect(isToolingHost(host)).toBe(false);
  });

  it.each(['my-company..my.salesforce.com', 'my company.my.salesforce.com', 'my_company.my.salesforce.com'])(
    'rejects malformed tenant prefix %s',
    (host) => {
      expect(isToolingHost(host)).toBe(false);
    },
  );
});

describe('decodeOrgIdFromCookie', () => {
  it('returns the orgId prefix from a sid cookie value', () => {
    expect(decodeOrgIdFromCookie('00DXXXXXXXXXXXX!opaqueSessionTokenBlob')).toBe('00DXXXXXXXXXXXX');
  });

  it('returns null when the cookie value lacks the ! delimiter', () => {
    expect(decodeOrgIdFromCookie('malformed-cookie-no-bang')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(decodeOrgIdFromCookie('')).toBeNull();
  });
});

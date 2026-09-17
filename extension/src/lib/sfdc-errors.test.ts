import { describe, expect, it } from 'vitest';

import {
  ApiDisabledError,
  ForbiddenError,
  InsufficientAccessError,
  OrgApiLimitReachedError,
  SessionExpiredError,
  SfdcError,
  SfdcNetworkError,
  SfdcTimeoutError,
} from './sfdc-errors';

describe('SFDC error classes', () => {
  it('SfdcError is the base; instances carry the expected name', () => {
    const e = new SfdcError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('SfdcError');
    expect(e.message).toBe('boom');
  });

  it.each([
    [SessionExpiredError, 'SessionExpiredError'],
    [ForbiddenError, 'ForbiddenError'],
    [OrgApiLimitReachedError, 'OrgApiLimitReachedError'],
    [ApiDisabledError, 'ApiDisabledError'],
    [InsufficientAccessError, 'InsufficientAccessError'],
    [SfdcNetworkError, 'SfdcNetworkError'],
    [SfdcTimeoutError, 'SfdcTimeoutError'],
  ] as const)('%s extends SfdcError and exposes its name', (Cls, expected) => {
    const e = new Cls('m');
    expect(e).toBeInstanceOf(SfdcError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe(expected);
  });

  it('SfdcTimeoutError is a SfdcNetworkError', () => {
    expect(new SfdcTimeoutError('slow')).toBeInstanceOf(SfdcNetworkError);
  });

  it('OrgApiLimitReachedError carries the Sforce-Limit-Info value when provided', () => {
    const e = new OrgApiLimitReachedError('msg', { sforceLimitInfo: 'api-usage=14999/15000' });
    expect(e.sforceLimitInfo).toBe('api-usage=14999/15000');
  });

  it('ForbiddenError carries the upstream errorCode when provided', () => {
    const e = new ForbiddenError('msg', { errorCode: 'SOMETHING_UNKNOWN' });
    expect(e.errorCode).toBe('SOMETHING_UNKNOWN');
  });
});

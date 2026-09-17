import { describe, expect, it } from 'vitest';

import { classify, isAbortError } from './sf-error-kind';
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

describe('classify', () => {
  it.each([
    [new SessionExpiredError('x'), 'sessionExpired'],
    [new OrgApiLimitReachedError('x'), 'orgApiLimitReached'],
    [new ApiDisabledError('x'), 'apiDisabled'],
    [new InsufficientAccessError('x'), 'insufficientAccess'],
    [new ForbiddenError('x', { errorCode: 'WAT' }), 'forbidden'],
    [new ForbiddenError('MCAS blocked'), 'proxyBlocked'],
    [new SfdcNetworkError('x'), 'network'],
    [new SfdcTimeoutError('x'), 'network'],
    [new SfdcError('HTTP 500: boom'), 'unknown'],
    [new SfdcError('HTTP 404: NOT_FOUND'), 'unknown'],
  ] as const)('%s -> %s', (err, expected) => {
    expect(classify(err)).toBe(expected);
  });

  it('unknown thrown value -> unknown', () => {
    expect(classify(new Error('boom'))).toBe('unknown');
    expect(classify('string')).toBe('unknown');
    expect(classify(undefined)).toBe('unknown');
  });
});

describe('isAbortError', () => {
  it('recognises a caller abort and nothing else', () => {
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('slow', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new SfdcNetworkError('x'))).toBe(false);
  });
});

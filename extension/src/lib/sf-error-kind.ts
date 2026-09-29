// Maps a thrown value from the Salesforce client to the error class the
// panel's states are designed around (the empty and error states). Which
// state to show is the active-flow hook's job.

import {
  ApiDisabledError,
  ForbiddenError,
  InsufficientAccessError,
  OrgApiLimitReachedError,
  SessionExpiredError,
  SfdcError,
  SfdcNetworkError,
} from './sfdc-errors';

export type SfErrorKind =
  | 'sessionExpired'
  | 'orgApiLimitReached'
  | 'apiDisabled'
  | 'insufficientAccess'
  | 'forbidden'
  /** A 403 with no Salesforce error code: a corporate proxy such as MCAS. */
  | 'proxyBlocked'
  | 'network'
  | 'unknown';

export function classify(err: unknown): SfErrorKind {
  if (err instanceof SessionExpiredError) return 'sessionExpired';
  if (err instanceof OrgApiLimitReachedError) return 'orgApiLimitReached';
  if (err instanceof ApiDisabledError) return 'apiDisabled';
  if (err instanceof InsufficientAccessError) return 'insufficientAccess';
  if (err instanceof ForbiddenError) return err.errorCode ? 'forbidden' : 'proxyBlocked';
  if (err instanceof SfdcNetworkError) return 'network';
  // Any other HTTP failure (404 for a deleted version, 5xx) is not an access
  // problem, so it is not 'forbidden': that would show the wrong copy.
  if (err instanceof SfdcError) return 'unknown';
  return 'unknown';
}

/** True when the rejection is a cancellation the caller asked for, not a failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

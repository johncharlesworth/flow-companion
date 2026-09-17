// Typed errors for the Salesforce Tooling API client. Ported from the
// earlier build build; SfdcTimeoutError is new and is a
// SfdcNetworkError so the UI treats a timeout like any other network failure.

export class SfdcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfdcError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SessionExpiredError extends SfdcError {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ForbiddenError extends SfdcError {
  errorCode?: string;
  constructor(message: string, opts: { errorCode?: string } = {}) {
    super(message);
    this.name = 'ForbiddenError';
    this.errorCode = opts.errorCode;
  }
}

export class OrgApiLimitReachedError extends SfdcError {
  sforceLimitInfo?: string;
  constructor(message: string, opts: { sforceLimitInfo?: string } = {}) {
    super(message);
    this.name = 'OrgApiLimitReachedError';
    this.sforceLimitInfo = opts.sforceLimitInfo;
  }
}

export class ApiDisabledError extends SfdcError {
  constructor(message: string) {
    super(message);
    this.name = 'ApiDisabledError';
  }
}

export class InsufficientAccessError extends SfdcError {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientAccessError';
  }
}

export class SfdcNetworkError extends SfdcError {
  declare cause?: unknown;
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = 'SfdcNetworkError';
    this.cause = opts.cause;
  }
}

export class SfdcTimeoutError extends SfdcNetworkError {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, opts);
    this.name = 'SfdcTimeoutError';
  }
}

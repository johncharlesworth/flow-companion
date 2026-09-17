// Minimal Salesforce REST client for the Tooling API, called from the side
// panel with the user's own session id. Ported from the earlier build build with
// the fixes named in every call carries an AbortSignal
// with a timeout (and can be cancelled by the caller), the request identifies
// itself with Sforce-Call-Options, and nothing is ever written to the console.

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

export const CLIENT_NAME = 'flow-companion';
export const DEFAULT_TIMEOUT_MS = 20_000;

export interface SfdcClientOptions {
  /** A My-Domain Tooling host, e.g. mycompany.my.salesforce.com (invariant 3). */
  sfHost: string;
  sid: string;
}

export interface RestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Caller cancellation (navigation away); an abort is rethrown as-is. */
  signal?: AbortSignal;
  /** Per-call deadline; expiry throws SfdcTimeoutError. */
  timeoutMs?: number;
}

export class SfdcClient {
  constructor(private readonly opts: SfdcClientOptions) {}

  async rest<T = unknown>(path: string, options: RestOptions = {}): Promise<T> {
    const url = `https://${this.opts.sfHost}${path}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { signal, cleanup } = withTimeout(options.signal, timeoutMs);
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.opts.sid}`,
        Accept: 'application/json',
        'Sforce-Call-Options': `client=${CLIENT_NAME}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
    };

    // The deadline and the caller's abort stay armed until the body has been
    // read: for a large flow the Metadata body is most of the wait.
    try {
      const response = await fetch(url, init);

      if (response.status === 401) {
        const message = await safeReadErrorMessage(response, 'Session expired');
        throw new SessionExpiredError(message);
      }
      if (response.status === 403) {
        const { errorCode, message } = await safeReadErrorParts(response);
        const sforceLimitInfo = response.headers.get('sforce-limit-info') ?? undefined;
        switch (errorCode) {
          case 'REQUEST_LIMIT_EXCEEDED':
            throw new OrgApiLimitReachedError(message ?? 'Org API limit reached', { sforceLimitInfo });
          case 'API_DISABLED_FOR_ORG':
            throw new ApiDisabledError(message ?? 'API disabled for this org');
          case 'INSUFFICIENT_ACCESS':
          case 'INSUFFICIENT_ACCESS_OR_READONLY':
            throw new InsufficientAccessError(message ?? 'Insufficient access');
          default:
            // Includes the corporate-proxy (MCAS) case: an HTML 403 with no
            // Salesforce error code is a ForbiddenError without an errorCode,
            // never "session expired".
            throw new ForbiddenError(message ?? 'Forbidden', { errorCode });
        }
      }
      if (response.ok) {
        return (await response.json()) as T;
      }
      const fallbackMessage = await safeReadErrorMessage(response, response.statusText);
      throw new SfdcError(`HTTP ${response.status}: ${fallbackMessage}`);
    } catch (cause) {
      if (cause instanceof SfdcError) throw cause;
      // Decide by signal state, not by error type: browsers reject an aborted
      // body read with an AbortError, Node's fetch with a plain TypeError.
      if (options.signal?.aborted) throw cause;
      if (signal.aborted) {
        throw new SfdcTimeoutError(`Salesforce did not answer within ${timeoutMs} ms`, { cause });
      }
      throw new SfdcNetworkError('Network error reaching Salesforce', { cause });
    } finally {
      cleanup();
    }
  }
}

/**
 * Combines the caller's signal with a deadline. Written by hand rather than
 * with AbortSignal.any so the extension works on Chrome 114.
 */
function withTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );
  const forward = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forward();
  else callerSignal?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forward);
    },
  };
}

async function safeReadErrorParts(
  response: Response,
): Promise<{ errorCode?: string; message?: string }> {
  try {
    const body: unknown = await response.clone().json();
    if (Array.isArray(body) && body.length > 0) {
      const entry = body[0] as { errorCode?: unknown; message?: unknown };
      return {
        errorCode: typeof entry?.errorCode === 'string' ? entry.errorCode : undefined,
        message: typeof entry?.message === 'string' ? entry.message : undefined,
      };
    }
  } catch {
    /* not JSON (for example a proxy's HTML page) */
  }
  return {};
}

async function safeReadErrorMessage(response: Response, fallback: string): Promise<string> {
  const { message } = await safeReadErrorParts(response);
  return message ?? fallback;
}

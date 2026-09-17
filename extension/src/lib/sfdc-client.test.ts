import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TIMEOUT_MS, SfdcClient } from './sfdc-client';
import {
  ApiDisabledError,
  ForbiddenError,
  InsufficientAccessError,
  OrgApiLimitReachedError,
  SessionExpiredError,
  SfdcNetworkError,
  SfdcTimeoutError,
} from './sfdc-errors';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A fetch that never resolves on its own but rejects when its signal aborts. */
function hangingFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

const client = () => new SfdcClient({ sfHost: 'mycompany.my.salesforce.com', sid: 'opaqueSid' });

describe('SfdcClient.rest — happy path', () => {
  it('GETs https://<sfHost><path> with Authorization: Bearer <sid> and returns JSON', async () => {
    const body = { hello: 'world' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, body));

    const res = await client().rest('/services/data/v67.0/limits');
    expect(res).toEqual(body);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://mycompany.my.salesforce.com/services/data/v67.0/limits');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer opaqueSid');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('identifies itself with Sforce-Call-Options: client=flow-companion', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    await client().rest('/services/data/v67.0/limits');
    const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
    expect(headers.get('sforce-call-options')).toBe('client=flow-companion');
  });

  it('always passes an AbortSignal to fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}));
    await client().rest('/services/data/v67.0/limits');
    expect(fetchSpy.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('writes nothing to the console, even when Sforce-Limit-Info is present', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true }, { 'sforce-limit-info': 'api-usage=42/15000' }),
    );
    await client().rest('/services/data/v67.0/limits');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('SfdcClient.rest — 401 handling', () => {
  it('throws SessionExpiredError when Salesforce returns 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired' }]),
    );
    await expect(client().rest('/services/data/v67.0/limits')).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});

describe('SfdcClient.rest — 403 error-code mapping', () => {
  it('REQUEST_LIMIT_EXCEEDED -> OrgApiLimitReachedError carrying Sforce-Limit-Info', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        403,
        [{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.' }],
        { 'sforce-limit-info': 'api-usage=15000/15000' },
      ),
    );
    const err = await client().rest('/services/data/v67.0/limits').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgApiLimitReachedError);
    expect((err as OrgApiLimitReachedError).sforceLimitInfo).toBe('api-usage=15000/15000');
  });

  it('API_DISABLED_FOR_ORG -> ApiDisabledError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, [{ errorCode: 'API_DISABLED_FOR_ORG', message: 'API disabled.' }]),
    );
    await expect(client().rest('/services/data/v67.0/limits')).rejects.toBeInstanceOf(
      ApiDisabledError,
    );
  });

  it.each(['INSUFFICIENT_ACCESS', 'INSUFFICIENT_ACCESS_OR_READONLY'])(
    '%s -> InsufficientAccessError',
    async (code) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(403, [{ errorCode: code, message: 'No access.' }]),
      );
      await expect(client().rest('/services/data/v67.0/limits')).rejects.toBeInstanceOf(
        InsufficientAccessError,
      );
    },
  );

  it('Unknown 403 errorCode -> ForbiddenError carrying errorCode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, [{ errorCode: 'SOMETHING_UNFAMILIAR', message: 'Nope.' }]),
    );
    const err = await client().rest('/services/data/v67.0/limits').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).errorCode).toBe('SOMETHING_UNFAMILIAR');
  });

  it('treats MCAS proxy 403 (HTML body, no Salesforce errorCode) as ForbiddenError, NOT session expired', async () => {
    // MCAS (Microsoft Cloud App Security) and similar corporate proxies wrap
    // Salesforce responses; the body is the proxy's own HTML, not the canonical
    // Salesforce error JSON. The client must NOT misclassify this as a
    // SessionExpiredError (which would mistakenly tell the user to log back in
    // to Salesforce) or as a more specific 403 sub-category that pretends to
    // know what's happening. Generic ForbiddenError is correct.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>MCAS blocked</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const err = await client().rest('/services/data/v67.0/anything').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
    expect(err).not.toBeInstanceOf(OrgApiLimitReachedError);
    expect(err).not.toBeInstanceOf(ApiDisabledError);
    expect(err).not.toBeInstanceOf(InsufficientAccessError);
  });
});

describe('SfdcClient.rest — network errors, timeouts, cancellation', () => {
  it('fetch() throwing -> SfdcNetworkError with cause set', async () => {
    const cause = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(cause);
    const err = await client().rest('/services/data/v67.0/limits').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SfdcNetworkError);
    expect((err as SfdcNetworkError).cause).toBe(cause);
  });

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('aborts after timeoutMs and throws SfdcTimeoutError', async () => {
      hangingFetch();
      const pending = client().rest('/services/data/v67.0/slow', { timeoutMs: 45_000 });
      const settled = pending.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(44_999);
      await vi.advanceTimersByTimeAsync(1);
      const err = await settled;
      expect(err).toBeInstanceOf(SfdcTimeoutError);
      expect(err).toBeInstanceOf(SfdcNetworkError);
    });

    it('defaults to DEFAULT_TIMEOUT_MS when no timeoutMs is given', async () => {
      hangingFetch();
      const settled = client()
        .rest('/services/data/v67.0/slow')
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
      expect(await settled).toBeInstanceOf(SfdcTimeoutError);
    });

    it("rethrows the caller's abort untouched so navigation-cancelled loads are not shown as errors", async () => {
      hangingFetch();
      const controller = new AbortController();
      const settled = client()
        .rest('/services/data/v67.0/slow', { signal: controller.signal, timeoutMs: 45_000 })
        .catch((e: unknown) => e);
      controller.abort();
      const err = await settled;
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
      expect(err).not.toBeInstanceOf(SfdcNetworkError);
    });

    it('keeps the deadline armed while the body streams (a stalled body times out)', async () => {
      // A 200 whose body never finishes: the deadline must still fire.
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const settled = client()
        .rest('/services/data/v67.0/slow-body', { timeoutMs: 45_000 })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await settled).toBeInstanceOf(SfdcTimeoutError);
    });

    it("rethrows the caller's abort raised during the body read", async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const controller = new AbortController();
      const settled = client()
        .rest('/services/data/v67.0/slow-body', { signal: controller.signal, timeoutMs: 45_000 })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      const err = await settled;
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
    });

    it('maps a body that fails mid-stream to SfdcNetworkError', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError('network error'));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const err = await client().rest('/services/data/v67.0/limits').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SfdcNetworkError);
      expect(err).not.toBeInstanceOf(SfdcTimeoutError);
    });

    it('does not fire the timeout after a successful response (timer is cleared)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }));
      const res = await client().rest('/services/data/v67.0/limits', { timeoutMs: 1_000 });
      expect(res).toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

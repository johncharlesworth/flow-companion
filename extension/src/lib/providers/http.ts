// Shared HTTP plumbing for the adapters: the request, the error classification
// (the error classes; provider body text is read for classification only and
// never surfaces), and the abort contract.

import type { ChatError, Chunk } from './types';

export interface ErrorBody {
  status: number;
  /** A short machine code when the provider gives one. */
  code: string;
  /** The provider's message, used only for pattern matching here. */
  message: string;
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  let code = '';
  let message = '';
  try {
    const body = (await response.json()) as { error?: { type?: string; code?: string; status?: string; message?: string } };
    code = body.error?.code ?? body.error?.type ?? body.error?.status ?? '';
    message = body.error?.message ?? '';
  } catch {
    /* not JSON */
  }
  return { status: response.status, code: String(code), message: String(message) };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function errorChunk(error: ChatError): Chunk {
  return { type: 'error', error };
}

/**
 * Runs a streaming request through `classify` and `consume`. On the caller's
 * abort it stops silently: the panel already knows it stopped.
 */
export async function* streamRequest(
  request: () => Promise<Response>,
  classify: (body: ErrorBody) => ChatError,
  consume: (body: ReadableStream<Uint8Array>) => AsyncGenerator<Chunk>,
  signal: AbortSignal,
): AsyncGenerator<Chunk> {
  let response: Response;
  try {
    response = await request();
  } catch (err) {
    if (signal.aborted || isAbort(err)) return;
    yield errorChunk({ class: 'interrupted' });
    return;
  }
  if (!response.ok) {
    yield errorChunk(classify(await readErrorBody(response)));
    return;
  }
  if (!response.body) {
    yield errorChunk({ class: 'unknown', status: response.status });
    return;
  }
  try {
    yield* consume(response.body);
  } catch (err) {
    if (signal.aborted || isAbort(err)) return;
    yield errorChunk({ class: 'interrupted' });
  }
}

/** Classes common to every provider by status alone. */
export function classifyByStatus(status: number): ChatError | null {
  if (status === 401) return { class: 'keyRejected', status };
  if (status === 404) return { class: 'modelUnavailable', status };
  if (status === 429) return { class: 'rateLimit', status };
  if (status === 529 || status === 503 || status === 502 || status === 500 || status === 504) return { class: 'providerBusy', status };
  return null;
}

// One SSE parser for all three providers. Tolerates CRLF, joins every data:
// line of an event, ignores comments and event-less pings, and flushes a
// trailing event that arrived without its blank-line terminator.

export interface SseEvent {
  event?: string;
  data: string;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match) break;
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseEvent(raw);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const tail = parseEvent(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export function parseEvent(raw: string): SseEvent | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  return { ...(event ? { event } : {}), data: data.join('\n') };
}

/** Reads the whole SSE stream as JSON payloads, skipping anything that is not JSON. */
export async function* parseJsonSse<T>(stream: ReadableStream<Uint8Array>, isDone: (data: string) => boolean = () => false): AsyncGenerator<T> {
  for await (const event of parseSse(stream)) {
    if (isDone(event.data)) return;
    try {
      yield JSON.parse(event.data) as T;
    } catch {
      /* not JSON: ignore */
    }
  }
}

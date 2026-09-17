import { describe, expect, it } from 'vitest';

import { parseEvent, parseJsonSse, parseSse } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('parseSse', () => {
  it('yields one event per blank-line-separated message and keeps the event name', async () => {
    const events = await collect(parseSse(streamOf(['event: message_start\ndata: {"a":1}\n\nevent: ping\ndata: {}\n\n'])));
    expect(events).toEqual([
      { event: 'message_start', data: '{"a":1}' },
      { event: 'ping', data: '{}' },
    ]);
  });

  it('reassembles an event split across chunks, even mid-character', async () => {
    const encoded = new TextEncoder().encode('data: {"text":"héllo"}\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 15));
        controller.enqueue(encoded.slice(15));
        controller.close();
      },
    });
    expect(await collect(parseSse(stream))).toEqual([{ data: '{"text":"héllo"}' }]);
  });

  it('tolerates CRLF line endings', async () => {
    const events = await collect(parseSse(streamOf(['data: one\r\n\r\ndata: two\r\n\r\n'])));
    expect(events.map((e) => e.data)).toEqual(['one', 'two']);
  });

  it('joins every data: line of an event with newlines', async () => {
    const events = await collect(parseSse(streamOf(['data: {"a":\ndata: 1}\n\n'])));
    expect(events).toEqual([{ data: '{"a":\n1}' }]);
  });

  it('flushes a trailing event that has no terminating blank line', async () => {
    const events = await collect(parseSse(streamOf(['data: first\n\n', 'data: last'])));
    expect(events.map((e) => e.data)).toEqual(['first', 'last']);
  });

  it('ignores comments and events without data', async () => {
    const events = await collect(parseSse(streamOf([': keep-alive\n\nevent: ping\n\ndata: x\n\n'])));
    expect(events).toEqual([{ data: 'x' }]);
    expect(parseEvent(': just a comment')).toBeNull();
  });

  it('parseJsonSse yields parsed payloads, skips junk, and stops at the done marker', async () => {
    const items = await collect(parseJsonSse<{ n: number }>(streamOf(['data: {"n":1}\n\ndata: not json\n\ndata: [DONE]\n\ndata: {"n":2}\n\n']), (d) => d === '[DONE]'));
    expect(items).toEqual([{ n: 1 }]);
  });
});

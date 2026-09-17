import type { ProviderId } from '@/lib/models';

import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { OpenAiProvider } from './openai';
import type { LLMProvider } from './types';

export function providerFor(id: ProviderId, fetchImpl?: typeof fetch): LLMProvider {
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(fetchImpl);
    case 'openai':
      return new OpenAiProvider(fetchImpl);
    case 'google':
      return new GoogleProvider(fetchImpl);
  }
}

export type { ChatError, ChatErrorClass, ChatMessage, Chunk, LLMProvider, SendArgs, StopReason, Usage } from './types';

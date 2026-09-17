import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { setProviderKey } from '@/lib/key-storage';
import { defaultSettings } from '@/lib/settings';

import { useSettings } from './useSettings';

describe('useSettings', () => {
  it('loads the record and readiness, and updates atomically', async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.readiness).toEqual({ ready: false, forgotten: false, unchecked: false });
    await act(async () => {
      await result.current.update((s) => ({ ...s, detail: 'concise' }));
    });
    expect(result.current.settings.detail).toBe('concise');
  });

  it('becomes ready once the active provider has a validated, present key, and follows storage changes', async () => {
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const s = defaultSettings();
    await act(async () => {
      await setProviderKey('anthropic', 'test-key-wxyz', 'local');
      await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [], checkedAt: 1 } } } });
    });
    await waitFor(() => expect(result.current.readiness.ready).toBe(true));
  });
});

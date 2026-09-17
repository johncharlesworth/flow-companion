// The settings record and readiness, kept current across the panel: any
// change to the record or to the stored keys (this panel or another window)
// re-reads.

import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { defaultSettings, readiness, type Readiness, readSettings, type Settings, updateSettings } from '@/lib/settings';
import { syncTheme } from '@/lib/theme';

export interface UseSettingsResult {
  settings: Settings;
  readiness: Readiness;
  loaded: boolean;
  update: (apply: (current: Settings) => Settings) => Promise<Settings>;
  reload: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState<Readiness>({ ready: false, forgotten: false, unchecked: false });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const next = await readSettings();
    const r = await readiness(next);
    setSettings(next);
    setReady(r);
    setLoaded(true);
    syncTheme(next.theme);
  }, []);

  useEffect(() => {
    let live = true;
    const onChanged = (_changes: unknown, area: string) => {
      if (area === 'local' || area === 'session') void reload();
    };
    void reload().then(() => {
      if (live) browser.storage.onChanged.addListener(onChanged);
    });
    return () => {
      live = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [reload]);

  const update = useCallback(
    async (apply: (current: Settings) => Settings) => {
      const next = await updateSettings(apply);
      await reload();
      return next;
    },
    [reload],
  );

  return { settings, readiness: ready, loaded, update, reload };
}

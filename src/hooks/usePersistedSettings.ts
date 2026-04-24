import { useCallback, useEffect, useState } from 'react';
import { AppSettings } from '../types';
import { db } from '../core/db';
import { DEFAULT_APP_SETTINGS, normalizePersistedSettings } from '../utils/appHelpers';

export const usePersistedSettings = (isLoaded: boolean) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  const loadPersistedSettings = useCallback(async () => {
    let persistedSettings = await db.getSettings();
    if (!persistedSettings) {
      const legacy = localStorage.getItem('anki_mcq_settings');
      if (legacy) {
        persistedSettings = JSON.parse(legacy);
        if (persistedSettings) await db.saveSettings(persistedSettings);
      }
    }

    if (persistedSettings) {
      const normalized = normalizePersistedSettings(persistedSettings);
      setSettings(normalized);
      return normalized;
    }

    return DEFAULT_APP_SETTINGS;
  }, []);

  useEffect(() => {
    if (isLoaded) db.saveSettings(settings);
  }, [settings, isLoaded]);

  return {
    settings,
    setSettings,
    loadPersistedSettings,
  };
};

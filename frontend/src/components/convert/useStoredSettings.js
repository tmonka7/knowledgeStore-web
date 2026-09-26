import { useEffect, useState } from 'react';

/**
 * Settings that survive a reload, per browser: whoever converts to 720p WebM
 * once usually wants it again. Storage can be unavailable (private window,
 * blocked site data), in which case the defaults are simply used.
 */
export default function useStoredSettings(key, defaults) {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || 'null');
      return stored && typeof stored === 'object' ? { ...defaults, ...stored } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      // Not stored; nothing else depends on it.
    }
  }, [key, settings]);

  const set = (patch) => setSettings((current) => ({ ...current, ...patch }));
  const reset = () => setSettings(defaults);
  return [settings, set, reset];
}

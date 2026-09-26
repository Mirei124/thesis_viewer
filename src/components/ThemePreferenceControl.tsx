import { useEffect, useLayoutEffect, useState } from 'react';

import {
  applyTheme,
  initialThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../lib/theme';

/** Keeps the outer UI palette independent from reader/PDF state. */
export function useThemePreference(): readonly [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(initialThemePreference);

  useLayoutEffect(() => {
    applyTheme(preference);
  }, [preference]);

  useEffect(() => {
    let active = true;
    void loadThemePreference().then((stored) => {
      if (!active || !stored) return;
      setPreference(stored);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (preference !== 'system' || typeof globalThis.matchMedia !== 'function') return;
    const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme('system');
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [preference]);

  function updatePreference(next: ThemePreference) {
    setPreference(next);
    applyTheme(next);
    void saveThemePreference(next).catch(() => undefined);
  }

  return [preference, updatePreference] as const;
}

type ThemePreferenceControlProps = {
  label: (key: 'appearance.legend' | 'appearance.help' | 'appearance.system' | 'appearance.light' | 'appearance.dark') => string;
};

export function ThemePreferenceControl({ label }: ThemePreferenceControlProps) {
  const [preference, setPreference] = useThemePreference();

  return (
    <fieldset className="theme-preferences">
      <legend>{label('appearance.legend')}</legend>
      <p className="field-help">{label('appearance.help')}</p>
      <div className="theme-choice-group" role="radiogroup" aria-label={label('appearance.legend')}>
        {(['system', 'light', 'dark'] as const).map((value) => (
          <label className="check-row" key={value}>
            <input
              type="radio"
              name="themePreference"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
            />
            {label(`appearance.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

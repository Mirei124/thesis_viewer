import { useEffect, useState } from 'react';

import {
  browserUiLocale,
  loadUiLocale,
  saveUiLocale,
  type UiLocale,
} from '../lib/i18n';

export function useUiLocale(): readonly [UiLocale, (locale: UiLocale) => void] {
  const [locale, setLocale] = useState<UiLocale>(() => browserUiLocale());

  useEffect(() => {
    let active = true;
    void loadUiLocale().then((stored) => {
      if (active && stored) setLocale(stored);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    globalThis.document?.documentElement.setAttribute('lang', locale);
  }, [locale]);

  function updateLocale(next: UiLocale) {
    setLocale(next);
    void saveUiLocale(next).catch(() => undefined);
  }

  return [locale, updateLocale] as const;
}

type LocalePreferenceControlProps = {
  locale: UiLocale;
  onChange: (locale: UiLocale) => void;
  label: (key: 'language.legend' | 'language.help' | 'language.en' | 'language.zh-CN') => string;
};

export function LocalePreferenceControl({ locale, onChange, label }: LocalePreferenceControlProps) {
  return (
    <fieldset className="locale-preferences">
      <legend>{label('language.legend')}</legend>
      <p className="field-help">{label('language.help')}</p>
      <div className="theme-choice-group" role="radiogroup" aria-label={label('language.legend')}>
        {(['en', 'zh-CN'] as const).map((value) => (
          <label className="check-row" key={value}>
            <input
              type="radio"
              name="uiLocale"
              value={value}
              checked={locale === value}
              onChange={() => onChange(value)}
            />
            {label(`language.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

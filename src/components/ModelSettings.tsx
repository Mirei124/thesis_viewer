import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';

import {
  clearApiKey,
  DEFAULT_MODEL_CONFIG,
  loadModelConfig,
  loadApiKey,
  saveModelConfig,
  normalizeModelConfig,
  saveApiKey,
  type ModelConfig,
} from '../lib/modelConfig';
import { ThemePreferenceControl } from './ThemePreferenceControl';
import { ArxivAutoOpenControl } from './ArxivAutoOpenControl';
import { LocalePreferenceControl, useUiLocale } from './LocalePreferenceControl';
import { message, type MessageKey } from '../lib/i18n';

import { requestApiHostPermission } from '../lib/apiPermissions';
import { DEFAULT_OVERVIEW_PREFERENCES, loadOverviewPreferences, saveOverviewPreferences, type OverviewPreferences } from '../lib/overviewPreferences';

type SettingsState = 'loading' | 'ready' | 'saving' | 'error';

export function ModelSettings() {
  const [locale, setLocale] = useUiLocale();
  const t = (key: MessageKey) => message(locale, key);
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [overviewPreferences, setOverviewPreferences] = useState<OverviewPreferences>(DEFAULT_OVERVIEW_PREFERENCES);
  const [apiKey, setApiKey] = useState('');
  const [rememberKey, setRememberKey] = useState(false);
  const [hasRememberedKey, setHasRememberedKey] = useState(false);
  const [state, setState] = useState<SettingsState>('loading');
  const [statusMessage, setStatusMessage] = useState('Loading settings…');

  useEffect(() => {
    let active = true;
    void Promise.all([loadModelConfig(), loadApiKey(), loadOverviewPreferences()])
      .then(([savedConfig, savedKey, savedPreferences]) => {
        if (!active) return;
        setConfig(savedConfig);
        setOverviewPreferences(savedPreferences);
        setApiKey(savedKey.apiKey ?? '');
        setRememberKey(savedKey.remembered);
        setHasRememberedKey(Boolean(savedKey.apiKey));
        setState('ready');
        setStatusMessage(t('settings.loaded'));
      })
      .catch(() => {
        if (!active) return;
        setState('error');
        setStatusMessage(t('settings.loadError'));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    globalThis.document.title = t('settings.title');
  }, [locale]);

  function updateText(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.currentTarget;
    if (name === 'apiKey') setApiKey(value);
    else if (name === 'contextLimit' || name === 'outputLimit') setConfig((current) => ({ ...current, [name]: Number(value) }));
    else setConfig((current) => ({ ...current, [name]: value }));
  }

  function updateCapability(event: ChangeEvent<HTMLInputElement>) {
    const { name, checked } = event.currentTarget;
    if (name === 'rememberKey') setRememberKey(checked);
    else setConfig((current) => ({ ...current, [name]: checked }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('saving');
    setStatusMessage(t('settings.saving'));
    try {
      const validated = normalizeModelConfig({ ...config, apiKey });
      // Initiate permission synchronously in the submit gesture, before any storage await.
      const permissionRequest = overviewPreferences.threeLine || overviewPreferences.detailed
        ? requestApiHostPermission(validated.baseUrl) : undefined;
      const permission = permissionRequest ? await permissionRequest : undefined;
      const preferences = permission && !permission.granted ? DEFAULT_OVERVIEW_PREFERENCES : overviewPreferences;
      const saved = await saveModelConfig(validated);
      await saveApiKey(apiKey, rememberKey);
      await saveOverviewPreferences(preferences);
      setOverviewPreferences(preferences);
      setConfig(saved);
      setHasRememberedKey(rememberKey && Boolean(apiKey.trim()));
      setState('ready');
      setStatusMessage(t(permission && !permission.granted ? 'settings.autoPermissionDenied' : 'settings.saved'));
    } catch (error) {
      setState('error');
      setStatusMessage(error instanceof Error ? error.message : t('settings.saveError'));
    }
  }

  async function clearKey() {
    setState('saving');
    setStatusMessage(t('settings.clearingKey'));
    try {
      await clearApiKey();
      setApiKey('');
      setRememberKey(false);
      setHasRememberedKey(false);
      setState('ready');
      setStatusMessage(t('settings.keyCleared'));
    } catch {
      setState('error');
      setStatusMessage(t('settings.clearKeyError'));
    }
  }

  const busy = state === 'loading' || state === 'saving';
  return (
    <main className="page-shell options-page" aria-labelledby="page-title">
      <section className="status-card options-card">
        <p className="eyebrow">{t('settings.eyebrow')}</p>
        <h1 id="page-title">{t('settings.title')}</h1>
        <p>{t('settings.intro')}</p>
        <form className="model-settings-form" onSubmit={save}>
          <label htmlFor="baseUrl">{t('settings.baseUrl')} <span aria-hidden="true">{t('settings.required')}</span></label>
          <input id="baseUrl" name="baseUrl" type="url" autoComplete="url" value={config.baseUrl} onChange={updateText} disabled={busy} required placeholder="https://api.deepseek.com/v1" />
          <p className="field-help">{t('settings.baseUrlHelp')}</p>

          <label htmlFor="model">{t('settings.model')} <span aria-hidden="true">{t('settings.required')}</span></label>
          <input id="model" name="model" value={config.model} onChange={updateText} disabled={busy} required placeholder="deepseek-flash" />

          <label htmlFor="apiKey">{t('settings.apiKey')} <span className="optional">{t('settings.optional')}</span></label>
          <input id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={updateText} disabled={busy} />
          <label className="check-row"><input name="rememberKey" type="checkbox" checked={rememberKey} onChange={updateCapability} disabled={busy} /> {t('settings.rememberKey')}</label>
          <p className="field-help">{t('settings.keyHelp')}</p>

          <fieldset disabled={busy}>
            <legend>{t('settings.capabilities')}</legend>
            <label className="check-row"><input name="structuredOutput" type="checkbox" checked={config.structuredOutput} onChange={updateCapability} /> {t('settings.structuredOutput')}</label>
            <p className="field-help">{t('settings.structuredOutputHelp')}</p>
            <label className="check-row"><input id="semanticReview" name="semanticReview" type="checkbox" checked={config.semanticReview === true} onChange={updateCapability} aria-describedby="semanticReviewHelp" /> {t('settings.semanticReview')}</label>
            <p id="semanticReviewHelp" className="field-help">{t('settings.semanticReviewHelp')}</p>
            <div className="limit-grid">
              <label htmlFor="contextLimit">{t('settings.contextLimit')} <input id="contextLimit" name="contextLimit" type="number" min="1" step="1" value={config.contextLimit} onChange={updateText} /></label>
              <label htmlFor="outputLimit">{t('settings.outputLimit')} <input id="outputLimit" name="outputLimit" type="number" min="1" step="1" value={config.outputLimit} onChange={updateText} /></label>
            </div>
            <p className="field-help">{t('settings.contextBudgetHelp')}</p>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>{t('settings.autoOverview')}</legend>
            <label className="check-row"><input name="autoThreeLine" type="checkbox" checked={overviewPreferences.threeLine} onChange={(event) => { const checked = event.currentTarget.checked; setOverviewPreferences((current) => ({ ...current, threeLine: checked })); }} /> {t('settings.autoThreeLine')}</label>
            <label className="check-row"><input name="autoDetailed" type="checkbox" checked={overviewPreferences.detailed} onChange={(event) => { const checked = event.currentTarget.checked; setOverviewPreferences((current) => ({ ...current, detailed: checked })); }} /> {t('settings.autoDetailed')}</label>
            <p className="field-help">{t('settings.autoOverviewHelp')}</p>
          </fieldset>

          <LocalePreferenceControl locale={locale} onChange={setLocale} label={t} />
          <ThemePreferenceControl label={t} />
          <ArxivAutoOpenControl disabled={busy} label={t} />

          <div className="settings-actions">
            <button type="submit" disabled={busy}>{t('settings.save')}</button>
            <button type="button" className="secondary-button" onClick={() => void clearKey()} disabled={busy || !hasRememberedKey}>{t('settings.clearKey')}</button>
          </div>
        </form>
        <p className={state === 'error' ? 'settings-message is-error' : 'settings-message'} role="status">{statusMessage}</p>
      </section>
    </main>
  );
}

import { useEffect, useState } from 'react';

import {
  requestArxivAutoOpenPermission,
  saveArxivAutoOpenEnabled,
  syncArxivAutoOpenEnabled,
} from '../lib/arxivAutoOpen';

type Status = 'loading' | 'enabled' | 'disabled' | 'denied' | 'unavailable' | 'request-failed' | 'save-failed';

type ArxivAutoOpenControlProps = {
  disabled?: boolean;
  label: (key: 'arxiv.legend' | 'arxiv.enable' | 'arxiv.help' | 'arxiv.loading' | 'arxiv.enabled' | 'arxiv.disabled' | 'arxiv.denied' | 'arxiv.unavailable' | 'arxiv.requestFailed' | 'arxiv.saveFailed') => string;
};

export function ArxivAutoOpenControl({ disabled = false, label }: ArxivAutoOpenControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [pending, setPending] = useState(false);

  async function refresh() {
    try {
      const nextEnabled = await syncArxivAutoOpenEnabled();
      setEnabled(nextEnabled);
      setStatus(nextEnabled ? 'enabled' : 'disabled');
    } catch {
      setEnabled(false);
      setStatus('save-failed');
    }
  }

  useEffect(() => {
    void refresh();
    // A user may remove the optional site access through the browser UI while
    // this page is open. Reconcile the persisted switch when they return.
    const onFocus = () => { void refresh(); };
    globalThis.addEventListener('focus', onFocus);
    return () => globalThis.removeEventListener('focus', onFocus);
  }, []);

  function setAutoOpen(nextEnabled: boolean) {
    if (!nextEnabled) {
      setPending(true);
      void saveArxivAutoOpenEnabled(false).then(() => {
        setEnabled(false);
        setStatus('disabled');
      }, () => {
        setEnabled(false);
        setStatus('save-failed');
      }).finally(() => setPending(false));
      return;
    }

    // Do not await before this call: Chromium and Firefox require the optional
    // permission dialog to originate in this click/change user gesture.
    const requested = requestArxivAutoOpenPermission();
    setPending(true);
    void requested.then(async (result) => {
      if (!result.granted) {
        setEnabled(false);
        setStatus(result.reason);
        return;
      }
      try {
        await saveArxivAutoOpenEnabled(true);
        setEnabled(true);
        setStatus('enabled');
      } catch {
        setEnabled(false);
        setStatus('save-failed');
      }
    }).finally(() => setPending(false));
  }

  const actualDisabled = disabled || pending || status === 'loading';
  return (
    <fieldset className="arxiv-auto-open" disabled={actualDisabled}>
      <legend>{label('arxiv.legend')}</legend>
      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setAutoOpen(event.currentTarget.checked)}
        />
        {label('arxiv.enable')}
      </label>
      <p className="field-help">{label('arxiv.help')}</p>
      <p className={status === 'denied' || status === 'unavailable' || status === 'request-failed' || status === 'save-failed' ? 'field-help is-error' : 'field-help'} role="status">
        {label(`arxiv.${status}` as Parameters<ArxivAutoOpenControlProps['label']>[0])}
      </p>
    </fieldset>
  );
}

import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import {
  assertReadersClosed, clearLocalData, exportLocalData, importLocalData,
  MAX_DATA_BACKUP_BYTES, parseDataBackup, summarizeDataBackup, type DataBackup,
} from '../lib/dataBackup';
import type { UiLocale } from '../lib/i18n';
import './dataManagementSettings.css';

const COPY = {
  'zh-CN': {
    title: '本地数据管理',
    description: '备份阅读历史与活动、高亮、概览、翻译、论文问答和非敏感设置。不包含 PDF 文件或 API Key。',
    privacy: '备份可能包含论文原文、选区和私人对话，请妥善保管。',
    closeReaders: '导入或清除前，请关闭所有论文阅读器标签页，防止旧页面重新写入数据。',
    export: '导出数据', import: '导入数据', clear: '清除数据',
    exportBusy: '正在导出…', fileBusy: '正在检查备份…', importBusy: '正在导入…', clearBusy: '正在清除…',
    exportDone: '备份已生成，请在浏览器下载记录中确认文件已保存。',
    importTitle: '导入本地备份？',
    importDetail: '将补充 {records} 条记录及最多 {settings} 项设置。相同 ID 的记录和已有设置保留本地版本；不会自动开启概览生成或 arXiv 接管。',
    importConfirm: '确认导入', importDone: '导入完成：新增 {imported} 条记录，跳过 {skipped} 条重复记录。设置已重新读取。',
    clearTitle: '确认清除本地数据？',
    clearDetail: '将删除全部阅读历史与活动、阅读位置、高亮、概览、翻译和论文问答。此操作无法撤销，建议先导出备份。',
    resetSettings: '同时重置所有设置并删除 API Key',
    keepSettings: '默认保留模型设置、API Key、语言、主题和其他偏好。',
    removeSettings: '还将重置模型设置、语言、主题和其他偏好，并删除持久保存及当前浏览器会话中的 API Key。',
    clearConfirm: '确认清除', clearDone: '阅读数据已清除，设置和 API Key 已保留。',
    resetDone: '阅读数据、设置和 API Key 已清除。设置表单已恢复默认值。',
    cancel: '取消', invalid: '无法读取该备份。请选择本扩展导出的有效 JSON 文件（最大 100 MiB）。',
    readersOpen: '请先关闭所有论文阅读器标签页，再重试。',
    failed: '操作失败，未能确认所有数据已成功处理。请保留备份并重试。',
    partial: '操作未完整完成，部分数据可能已变化。请保留备份并重试。',
    unavailable: '当前浏览器无法访问扩展存储，暂时无法管理数据。',
    refresh: '刷新设置页', refreshHelp: '如语言或主题尚未更新，可刷新设置页。',
  },
  en: {
    title: 'Local data',
    description: 'Back up reading history and activity, highlights, overviews, translations, paper conversations, and non-sensitive settings. PDF files and API keys are excluded.',
    privacy: 'Backups may contain paper text, selections, and private conversations. Keep them in a safe place.',
    closeReaders: 'Close all paper reader tabs before importing or clearing data so that open pages cannot write old data back.',
    export: 'Export data', import: 'Import data', clear: 'Clear data',
    exportBusy: 'Exporting…', fileBusy: 'Checking backup…', importBusy: 'Importing…', clearBusy: 'Clearing…',
    exportDone: 'Backup generated. Check your browser downloads to confirm the file was saved.',
    importTitle: 'Import this local backup?',
    importDetail: 'Add up to {records} records and {settings} settings. Existing records with the same ID and existing settings take priority. Automatic overviews and arXiv handling will not be enabled.',
    importConfirm: 'Confirm import', importDone: 'Import complete: {imported} records added; {skipped} duplicate records skipped. Settings have been reloaded.',
    clearTitle: 'Clear local data?',
    clearDetail: 'This deletes all reading history and activity, reading positions, highlights, overviews, translations, and paper conversations. This cannot be undone. Export a backup first if needed.',
    resetSettings: 'Also reset all settings and delete API keys',
    keepSettings: 'Model settings, API keys, language, theme, and other preferences are kept by default.',
    removeSettings: 'Model settings, language, theme, and other preferences will also be reset. Both remembered and browser-session API keys will be deleted.',
    clearConfirm: 'Confirm clear', clearDone: 'Reading data cleared. Settings and API keys were kept.',
    resetDone: 'Reading data, settings, and API keys cleared. The settings form now uses the defaults.',
    cancel: 'Cancel', invalid: 'Could not read this backup. Select a valid JSON backup exported by this extension (maximum 100 MiB).',
    readersOpen: 'Close all paper reader tabs, then try again.',
    failed: 'The operation failed; not all data could be confirmed as processed. Keep your backup and try again.',
    partial: 'The operation did not finish completely. Some data may have changed. Keep your backup and try again.',
    unavailable: 'Extension storage is unavailable in this browser. Data cannot be managed right now.',
    refresh: 'Refresh settings page', refreshHelp: 'Refresh this page if the language or theme has not updated.',
  },
} as const;
type CopyKey = keyof typeof COPY.en;
type Notice = { key: CopyKey; error?: boolean; values?: Record<string, number> };
type Operation = 'export' | 'file' | 'import' | 'clear';
type DialogContent = { kind: 'import'; backup: DataBackup; summary: { records: number; settings: number } } | { kind: 'clear' };

export function DataManagementSettings({ locale, disabled = false, onBusyChange, onSettingsChanged }: {
  locale: UiLocale;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSettingsChanged?: () => void;
}) {
  const labels = COPY[locale];
  const format = (key: CopyKey, values?: Record<string, number>) => String(labels[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [operation, setOperation] = useState<Operation>();
  const [content, setContent] = useState<DialogContent>();
  const [resetSettings, setResetSettings] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [changedSettings, setChangedSettings] = useState(false);
  const busy = operation !== undefined;

  useEffect(() => {
    if (!content || !dialog.current || dialog.current.open) return;
    // Preflight briefly disables the trigger and drops focus. Restore it before
    // opening so the native dialog can return focus to the right action on close.
    (content.kind === 'clear' ? clearButton.current : importButton.current)?.focus();
    dialog.current.showModal();
    cancelButton.current?.focus();
  }, [content]);

  useEffect(() => () => {
    for (const [url, timer] of downloadUrls.current) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
  }, []);

  function begin(next: Operation): boolean {
    if (locked.current || disabled) return false;
    locked.current = true;
    setOperation(next);
    setNotice(undefined);
    onBusyChange?.(true);
    return true;
  }
  function finish() {
    locked.current = false;
    setOperation(undefined);
    onBusyChange?.(false);
  }
  function failed(error: unknown, fallback: CopyKey = 'failed') {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const key = code === 'READERS_OPEN' ? 'readersOpen'
      : code === 'INVALID_BACKUP' ? 'invalid'
      : code === 'PARTIAL_WRITE' ? 'partial'
      : code === 'STORAGE_UNAVAILABLE' ? 'unavailable' : fallback;
    setNotice({ key, error: true });
  }
  function closeDialog() {
    if (locked.current) return;
    dialog.current?.close();
    setContent(undefined);
  }
  async function exportData() {
    if (!begin('export')) return;
    try {
      const backup = await exportLocalData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `thesis-viewer-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 1_000);
      downloadUrls.current.set(url, timer);
      setNotice({ key: 'exportDone' });
    } catch (error) { failed(error); }
    finally { finish(); }
  }
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !begin('file')) return;
    try {
      if (file.size > MAX_DATA_BACKUP_BYTES) { setNotice({ key: 'invalid', error: true }); return; }
      await assertReadersClosed();
      const backup = parseDataBackup(await file.text());
      setContent({ kind: 'import', backup, summary: summarizeDataBackup(backup) });
    } catch (error) { failed(error, 'invalid'); }
    finally { finish(); }
  }
  async function openClear() {
    if (!begin('file')) return;
    try {
      await assertReadersClosed();
      setResetSettings(false);
      setContent({ kind: 'clear' });
    } catch (error) { failed(error); }
    finally { finish(); }
  }
  async function confirm() {
    if (!content || !begin(content.kind)) return;
    try {
      if (content.kind === 'import') {
        const result = await importLocalData(content.backup);
        setNotice({ key: 'importDone', values: result });
        setChangedSettings(true);
        onSettingsChanged?.();
      } else {
        await clearLocalData(resetSettings);
        setNotice({ key: resetSettings ? 'resetDone' : 'clearDone' });
        if (resetSettings) { setChangedSettings(true); onSettingsChanged?.(); }
      }
      dialog.current?.close();
      setContent(undefined);
    } catch (error) { failed(error); }
    finally { finish(); }
  }

  const progressKey: CopyKey | undefined = operation ? `${operation}Busy` as CopyKey : undefined;
  return (
    <section className="data-management" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <h2 id={`${id}-title`}>{labels.title}</h2>
      <p>{labels.description}</p>
      <p className="field-help">{labels.privacy}</p>
      <p className="field-help">{labels.closeReaders}</p>
      <div className="settings-actions data-management-actions">
        <button type="button" className="secondary-button" disabled={disabled || busy} onClick={() => void exportData()}>{labels.export}</button>
        <button ref={importButton} type="button" className="secondary-button" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>{labels.import}</button>
        <button ref={clearButton} type="button" className="secondary-button data-danger-button" disabled={disabled || busy} onClick={() => void openClear()}>{labels.clear}</button>
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json" aria-label={labels.import} hidden onChange={(event) => void selectFile(event)} />
      {(notice || progressKey) && <p className={`settings-message${notice?.error ? ' is-error' : ''}`} role="status">{progressKey ? format(progressKey) : notice && format(notice.key, notice.values)}</p>}
      {changedSettings && <p className="field-help data-refresh-help">{labels.refreshHelp} <button type="button" className="data-refresh-button" disabled={disabled || busy} onClick={() => window.location.reload()}>{labels.refresh}</button></p>}
      <dialog ref={dialog} className="data-management-dialog" aria-labelledby={`${id}-dialog-title`} aria-describedby={`${id}-dialog-description`}
        onCancel={(event) => { if (locked.current) event.preventDefault(); }}
        onClose={() => { if (!locked.current) setContent(undefined); }}>
        <h2 id={`${id}-dialog-title`}>{content?.kind === 'clear' ? labels.clearTitle : labels.importTitle}</h2>
        <p id={`${id}-dialog-description`}>{content?.kind === 'import' ? format('importDetail', content.summary) : labels.clearDetail}</p>
        {content?.kind === 'clear' && <>
          <label className="check-row"><input type="checkbox" checked={resetSettings} disabled={busy} onChange={(event) => setResetSettings(event.currentTarget.checked)} />{labels.resetSettings}</label>
          <p className="field-help">{resetSettings ? labels.removeSettings : labels.keepSettings}</p>
        </>}
        <p className="field-help">{labels.closeReaders}</p>
        <div className="data-dialog-status" aria-live="polite">{progressKey ? format(progressKey) : notice?.error ? format(notice.key, notice.values) : ''}</div>
        <div className="settings-actions data-dialog-actions">
          <button ref={cancelButton} type="button" className="secondary-button" autoFocus disabled={busy} onClick={closeDialog}>{labels.cancel}</button>
          <button type="button" className={content?.kind === 'clear' ? 'data-danger-button' : ''} disabled={disabled || busy} onClick={() => void confirm()}>{content?.kind === 'clear' ? labels.clearConfirm : labels.importConfirm}</button>
        </div>
      </dialog>
    </section>
  );
}

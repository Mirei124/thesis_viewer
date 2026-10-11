export type ZoomMode = 'auto' | 'fit-page' | 'fit-width' | 'manual';
export type ZoomChoice = 'auto' | 'actual' | 'fit-page' | 'fit-width' | '50' | '75' | '100' | '125' | '150' | '200' | '300' | '400' | 'custom';

export const ZOOM_CHOICES: readonly ZoomChoice[] = ['auto', 'actual', 'fit-page', 'fit-width', '50', '75', '100', '125', '150', '200', '300', '400'];
export const MIN_ZOOM_SCALE = 0.25;
export const MAX_ZOOM_SCALE = 4;

export function clampZoomScale(scale: number): number {
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, Math.round(scale * 100) / 100));
}

export function zoomChoiceMode(choice: ZoomChoice): ZoomMode {
  return choice === 'auto' || choice === 'fit-page' || choice === 'fit-width' ? choice : 'manual';
}

export function zoomChoiceScale(choice: ZoomChoice): number | undefined {
  if (choice === 'actual') return 1;
  if (choice === 'custom' || zoomChoiceMode(choice) !== 'manual') return undefined;
  return clampZoomScale(Number(choice) / 100);
}

export function manualZoomChoice(scale: number): ZoomChoice {
  const percentage = String(Math.round(clampZoomScale(scale) * 100)) as ZoomChoice;
  return ZOOM_CHOICES.includes(percentage) ? percentage : 'custom';
}

export function zoomPercentDisplay(scale: number, editing: boolean): string {
  const percentage = String(Math.round(clampZoomScale(scale) * 100));
  return editing ? percentage : `${percentage}%`;
}

export function parseZoomPercentInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const percentage = Number(trimmed);
  return Number.isSafeInteger(percentage) && percentage >= MIN_ZOOM_SCALE * 100 && percentage <= MAX_ZOOM_SCALE * 100 ? percentage : null;
}

export function shouldCommitZoomOnKeyDown(key: string, isComposing: boolean): boolean {
  return key === 'Enter' && !isComposing;
}

export function fittedZoomScale(mode: Exclude<ZoomMode, 'manual'>, pageWidth: number, pageHeight: number, availableWidth: number, availableHeight: number): number {
  const widthScale = availableWidth / pageWidth;
  const heightScale = availableHeight / pageHeight;
  const scale = mode === 'fit-page' ? Math.min(widthScale, heightScale) : mode === 'auto' ? Math.min(1.35, widthScale) : widthScale;
  return clampZoomScale(scale);
}

/** Wheel delta units differ between trackpads and mouse/browser settings. */
export function zoomWheelDelta(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaY' | 'deltaMode' | 'cancelable'>, pageHeight: number): number | null {
  if ((!event.ctrlKey && !event.metaKey) || !event.cancelable || !Number.isFinite(event.deltaY) || event.deltaY === 0) return null;
  return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, pageHeight) : 1);
}

export type ZoomPointer = { clientX: number; clientY: number };

/** Coalesce high-frequency gestures, retaining sub-percent deltas between frames. */
export function bindPdfWheelZoom(element: HTMLElement, options: {
  getScale: () => number;
  apply: (scale: number, pointer: ZoomPointer) => Promise<void>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}) {
  let frame = 0;
  let disposed = false;
  let applying = false;
  let pending = false;
  let desiredScale = options.getScale();
  let lastAppliedScale = desiredScale;
  let pointer: ZoomPointer = { clientX: 0, clientY: 0 };
  const schedule = () => {
    if (disposed || frame || applying || !pending) return;
    frame = options.requestFrame(() => {
      frame = 0;
      if (disposed) return;
      pending = false;
      const scale = clampZoomScale(desiredScale);
      if (scale === options.getScale()) return;
      lastAppliedScale = scale;
      applying = true;
      void (async () => {
        try { await options.apply(scale, pointer); }
        catch { /* The reader owns PDF render errors; allow the next gesture. */ }
        finally { applying = false; schedule(); }
      })();
    });
  };
  const onWheel = (event: WheelEvent) => {
    const delta = zoomWheelDelta(event, element.ownerDocument?.defaultView?.innerHeight ?? element.clientHeight);
    if (delta === null) return;
    event.preventDefault();
    if (!applying && !pending && options.getScale() !== lastAppliedScale) {
      desiredScale = options.getScale();
      lastAppliedScale = desiredScale;
    }
    desiredScale = Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, desiredScale * Math.exp(-delta * 0.002)));
    pointer = { clientX: event.clientX, clientY: event.clientY };
    pending = true;
    schedule();
  };
  element.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    disposed = true;
    element.removeEventListener('wheel', onWheel);
    if (frame) options.cancelFrame(frame);
  };
}

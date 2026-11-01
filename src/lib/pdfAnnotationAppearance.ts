/** Underlines follow the native reading baseline as the user rotates the page. */
export function pdfUnderlineEdge(userRotation: number): 'bottom' | 'left' | 'top' | 'right' {
  const rotation = ((userRotation % 360) + 360) % 360;
  return rotation === 90 ? 'left' : rotation === 180 ? 'top' : rotation === 270 ? 'right' : 'bottom';
}

type PopupPoint = { left: number; top: number };
type PopupBounds = PopupPoint & { width: number; height: number };
/** Keep a transformed popup inside the viewport without changing its anchor or transform convention. */
export function clampAnnotationPopup(anchor: PopupPoint, bounds: PopupBounds, viewport: { width: number; height: number }, padding = 8): PopupPoint {
  const left = Math.max(padding, Math.min(bounds.left, Math.max(padding, viewport.width - bounds.width - padding)));
  const top = Math.max(padding, Math.min(bounds.top, Math.max(padding, viewport.height - bounds.height - padding)));
  return { left: anchor.left + left - bounds.left, top: anchor.top + top - bounds.top };
}

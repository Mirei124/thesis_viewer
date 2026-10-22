/** Base RGBA storage only; browsers may retain additional CPU/GPU copies. */
export const READER_BITMAP_BUDGET = 64 * 1024 * 1024;
export function bitmapBytes(width: number, height: number): number {
  return Math.max(0, width) * Math.max(0, height) * 4;
}
export function selectReaderBitmaps(pages: Array<{ index: number; visible: boolean; distance: number; bytes: number }>, budget = READER_BITMAP_BUDGET): number[] {
  const ordered = [...pages].sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance || a.index - b.index);
  let used = 0;
  return ordered.filter((page) => {
    if (!page.visible && used + page.bytes > budget) return false;
    used += page.bytes;
    return true;
  }).map((page) => page.index);
}
/** Never resize a canvas while PDF.js is still writing into it. */
export async function settleBitmapTask(task: { cancel(): void; promise: Promise<unknown> } | undefined): Promise<void> {
  if (!task) return;
  task.cancel();
  await task.promise.catch(() => undefined);
}
export function releaseReaderBitmap(canvas: { width: number; height: number; dataset: { renderKey?: string } }): void {
  canvas.width = 0;
  canvas.height = 0;
  delete canvas.dataset.renderKey;
}

export async function retireReaderBitmap(
  canvas: Parameters<typeof releaseReaderBitmap>[0],
  task: Parameters<typeof settleBitmapTask>[0],
  stillRetired: () => boolean,
): Promise<boolean> {
  // A page may already be active again before retirement starts. Do not
  // cancel its live render merely because it appeared in an older plan.
  if (!stillRetired()) return false;
  await settleBitmapTask(task);
  if (!stillRetired()) return false;
  releaseReaderBitmap(canvas);
  return true;
}

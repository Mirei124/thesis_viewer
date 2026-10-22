(() => {
  window.__b101PerfObserver?.disconnect();
  const samples = window.__b101ImportTimings = [];
  let started = 0, oldCanvas, current;
  const sample = () => {
    if (!current) return;
    const canvas = document.querySelector('.is-active-page canvas');
    if (!canvas || canvas === oldCanvas) return;
    if (canvas.dataset.renderKey && current.firstBitmapMs === undefined) current.firstBitmapMs = performance.now() - started;
    if (document.querySelectorAll('.is-active-page .textLayer span').length && current.selectableTextMs === undefined) current.selectableTextMs = performance.now() - started;
  };
  window.__b101PerfObserver = new MutationObserver(sample);
  window.__b101PerfObserver.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  document.querySelector('input[type=file]').addEventListener('change', () => {
    oldCanvas = document.querySelector('.is-active-page canvas');
    started = performance.now(); current = {}; samples.push(current);
  }, true);
})();

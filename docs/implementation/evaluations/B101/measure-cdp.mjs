// Read-only measurements of this batch's isolated localhost reader previews.
// Usage: node measure-cdp.mjs http://127.0.0.1:39809 > capture.json
const endpoint = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || '')) throw new Error('Pass a loopback CDP HTTP endpoint.');
const targets = await fetch(`${endpoint}/json/list`).then(r => r.json());
async function sample(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let next = 0;
  const pending = new Map();
  socket.onmessage = event => { const result = JSON.parse(event.data); const job = pending.get(result.id); if (!job) return; pending.delete(result.id); result.error ? job.reject(result.error) : job.resolve(result.result); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  try {
    const result = await call('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({visibility:document.visibilityState,dpr:devicePixelRatio,scrollY,scrollHeight:document.documentElement.scrollHeight,domNodes:document.querySelectorAll('*').length,thumbnailImages:document.querySelectorAll('.thumbnail-list img').length,textSpans:document.querySelectorAll('.textLayer span').length,canvases:[...document.querySelectorAll('.pdf-page canvas')].map(c=>({width:c.width,height:c.height,key:c.dataset.renderKey,visible:c.getBoundingClientRect().bottom>0&&c.getBoundingClientRect().top<innerHeight})),diagnostics:document.querySelector('.reader-stage')?.dataset.bitmapDiagnostics})` });
    const data = JSON.parse(result.result.value);
    const heap = await call('Runtime.getHeapUsage');
    return { url: target.url, ...data, rgbaBytes: data.canvases.reduce((n, c) => n + c.width * c.height * 4, 0), allocatedCanvases: data.canvases.filter(c => c.width && c.height).length, heap };
  } finally { socket.close(); }
}
const readers = targets.filter(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:876[78]\/reader\.html/.test(t.url));
const pages = await Promise.all(readers.map(sample));
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), targetsByType: Object.fromEntries([...new Set(targets.map(t => t.type))].map(type => [type, targets.filter(t => t.type === type).length])), rgbaBytes: pages.reduce((n, p) => n + p.rgbaBytes, 0), allocatedCanvases: pages.reduce((n, p) => n + p.allocatedCanvases, 0), pages }, null, 2));

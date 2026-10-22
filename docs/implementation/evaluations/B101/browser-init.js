(() => {
  if (!['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin)) return;
  const defaults = { 'overview-auto-generate:v1': { threeLine: false, detailed: false } };
  const read = () => ({ ...defaults, ...JSON.parse(localStorage.getItem('b101-storage') || '{}') });
  const area = {
    get: async key => ({ [key]: read()[key] }),
    set: async values => localStorage.setItem('b101-storage', JSON.stringify({ ...read(), ...values })),
    remove: async keys => { const data = read(); for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; localStorage.setItem('b101-storage', JSON.stringify(data)); },
  };
  window.browser = { storage: { local: area, session: area }, permissions: { request: async () => false, contains: async () => false } };
})();

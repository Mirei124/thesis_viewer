import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Thesis Viewer',
    description: 'A local-first paper reader extension.',
    version: '0.1.0',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    permissions: ['storage', 'webNavigation'],
    // HTTPS hosts are requested at the moment a user starts a provider task.
    // Local HTTP is deliberately limited to explicit loopback development APIs.
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: {
          required: ['none'],
        },
        id: 'thesis-viewer@example.invalid',
        strict_min_version: '121.0',
      },
    },
  },
});

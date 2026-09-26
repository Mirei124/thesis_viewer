import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Thesis Viewer',
    description: 'A local-first paper reader extension.',
    version: '0.1.0',
    permissions: ['storage', 'webNavigation'],
    // HTTPS hosts are requested at the moment a user starts a provider task.
    // Local HTTP is deliberately limited to explicit loopback development APIs.
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
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

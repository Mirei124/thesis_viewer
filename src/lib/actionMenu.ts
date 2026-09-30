export const ACTION_MENU_READER_ID = 'thesis-viewer-open-reader';
export const ACTION_MENU_OPTIONS_ID = 'thesis-viewer-open-options';

type MenuItem = { id: string; title: string; contexts: ['action'] };

export type ActionMenuApi = {
  menus: {
    removeAll: () => Promise<void> | void;
    create: (item: MenuItem) => unknown;
    onClicked: { addListener: (listener: (info: { menuItemId: string | number }) => void) => void };
  };
  runtime: {
    getURL: (path: string) => string;
    onInstalled: { addListener: (listener: () => void) => void };
  };
  tabs: { create: (properties: { url: string }) => Promise<unknown> };
};

export function registerActionMenu(api: ActionMenuApi): void {
  api.runtime.onInstalled.addListener(() => {
    // Menus survive background restarts. Rebuild only on install/update so
    // repeated registration cannot leave stale or duplicate entries.
    void (async () => {
      try {
        await api.menus.removeAll();
        api.menus.create({ id: ACTION_MENU_READER_ID, title: '打开阅读器', contexts: ['action'] });
        api.menus.create({ id: ACTION_MENU_OPTIONS_ID, title: '设置', contexts: ['action'] });
      } catch (error) {
        console.error('Failed to register extension action menu.', error);
      }
    })();
  });

  api.menus.onClicked.addListener((info) => {
    const page = info.menuItemId === ACTION_MENU_READER_ID ? 'reader.html'
      : info.menuItemId === ACTION_MENU_OPTIONS_ID ? 'options.html' : undefined;
    if (page) void (async () => {
      try { await api.tabs.create({ url: api.runtime.getURL(page) }); }
      catch (error) { console.error('Failed to open extension page from action menu.', error); }
    })();
  });
}

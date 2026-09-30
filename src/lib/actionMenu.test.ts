import { describe, expect, it, vi } from 'vitest';
import {
  ACTION_MENU_OPTIONS_ID,
  ACTION_MENU_READER_ID,
  registerActionMenu,
  type ActionMenuApi,
} from './actionMenu';

function setup() {
  let installed: (() => void) | undefined;
  let clicked: ((info: { menuItemId: string | number }) => void) | undefined;
  const items = new Map<string, { title: string; contexts: ['action'] }>();
  const removeAll = vi.fn(async () => { items.clear(); });
  const create = vi.fn((item: { id: string; title: string; contexts: ['action'] }) => {
    if (items.has(item.id)) throw new Error(`duplicate menu: ${item.id}`);
    items.set(item.id, { title: item.title, contexts: item.contexts });
  });
  const createTab = vi.fn(async (_properties: { url: string }) => undefined);
  const api: ActionMenuApi = {
    menus: {
      removeAll,
      create,
      onClicked: { addListener: (listener) => { clicked = listener; } },
    },
    runtime: {
      getURL: (path) => `moz-extension://extension/${path}`,
      onInstalled: { addListener: (listener) => { installed = listener; } },
    },
    tabs: { create: createTab },
  };
  registerActionMenu(api);
  return { installed: () => installed?.(), clicked: (id: string) => clicked?.({ menuItemId: id }), items, removeAll, create, createTab };
}

describe('action menu', () => {
  it('creates exactly two action items on install and rebuilds them on update', async () => {
    const menu = setup();
    expect(menu.create).not.toHaveBeenCalled();

    menu.installed();
    await vi.waitFor(() => expect(menu.items.size).toBe(2));
    expect([...menu.items]).toEqual([
      [ACTION_MENU_READER_ID, { title: '打开阅读器', contexts: ['action'] }],
      [ACTION_MENU_OPTIONS_ID, { title: '设置', contexts: ['action'] }],
    ]);

    menu.installed();
    await vi.waitFor(() => expect(menu.removeAll).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(menu.create).toHaveBeenCalledTimes(4));
    expect(menu.items.size).toBe(2);
  });

  it('opens the matching extension page and ignores unrelated menu IDs', () => {
    const menu = setup();
    menu.clicked(ACTION_MENU_READER_ID);
    menu.clicked(ACTION_MENU_OPTIONS_ID);
    menu.clicked('unrelated');

    expect(menu.createTab).toHaveBeenCalledTimes(2);
    expect(menu.createTab).toHaveBeenNthCalledWith(1, { url: 'moz-extension://extension/reader.html' });
    expect(menu.createTab).toHaveBeenNthCalledWith(2, { url: 'moz-extension://extension/options.html' });
  });
});

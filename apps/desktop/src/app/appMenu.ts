/**
 * The macOS menu bar in the interface language. Tauri's default menu is written in English,
 * so the operator window replaces it with the same items in the catalogue's words, and again
 * whenever the language changes. Windows and Linux show no menu bar.
 */
import { getName, getVersion } from '@tauri-apps/api/app';
import { Menu, Submenu, type PredefinedMenuItemOptions } from '@tauri-apps/api/menu';
import { subscribeLocale, t } from '@worship-q/i18n/desktop';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);

async function build(name: string, version: string): Promise<Menu> {
  const app = { app: t('app.name') };
  const item = (
    kind: PredefinedMenuItemOptions['item'],
    text: string,
  ): PredefinedMenuItemOptions => ({
    item: kind,
    text,
  });
  const separator: PredefinedMenuItemOptions = { item: 'Separator' };
  const windowMenu = await Submenu.new({
    text: t('menu.window'),
    items: [
      item('Minimize', t('menu.minimize')),
      item('Maximize', t('menu.zoom')),
      separator,
      item('CloseWindow', t('menu.closeWindow')),
    ],
  });
  const help = await Submenu.new({ text: t('menu.help'), items: [] });
  const menu = await Menu.new({
    items: [
      {
        text: t('app.name'),
        items: [
          item({ About: { name, version } }, t('menu.about', app)),
          separator,
          item('Services', t('menu.services')),
          separator,
          item('Hide', t('menu.hide', app)),
          item('HideOthers', t('menu.hideOthers')),
          item('ShowAll', t('menu.showAll')),
          separator,
          item('Quit', t('menu.quit', app)),
        ],
      },
      { text: t('menu.file'), items: [item('CloseWindow', t('menu.closeWindow'))] },
      {
        text: t('menu.edit'),
        items: [
          item('Undo', t('menu.undo')),
          item('Redo', t('menu.redo')),
          separator,
          item('Cut', t('menu.cut')),
          item('Copy', t('menu.copy')),
          item('Paste', t('menu.paste')),
          item('SelectAll', t('menu.selectAll')),
        ],
      },
      { text: t('menu.view'), items: [item('Fullscreen', t('menu.fullScreen'))] },
      windowMenu,
      help,
    ],
  });
  await windowMenu.setAsWindowsMenuForNSApp();
  await help.setAsHelpMenuForNSApp();
  return menu;
}

/** Sets the translated menu now and after each change of language; for the operator window. */
export function startAppMenu(): void {
  if (!isMac) return;
  let queue = Promise.resolve();
  const apply = () => {
    queue = queue
      .then(async () => {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        const previous = await (await build(name, version)).setAsAppMenu();
        await previous?.close();
      })
      .catch((error: unknown) => console.warn('Could not set the menu', error));
  };
  apply();
  subscribeLocale(apply);
}

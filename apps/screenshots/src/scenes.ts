// The screenshots, each a page of the app put into a state worth showing. Find things the way
// a volunteer would, by their visible text in the pictures' language, so a renamed button
// fails loudly here.

import type { MessageKey } from '@worship-q/i18n/desktop';
import type { Page } from 'playwright';
import type { Content } from './content';

export interface SceneTools {
  /** Opens the slideshow window, showing what the main window last sent it. */
  slideshow(size?: { width: number; height: number }): Promise<Page>;
  /** What the pictures show, in their language. */
  content: Content;
  /** The app's words in the pictures' language, to find buttons by. */
  t(key: MessageKey): string;
}

export interface Scene {
  /** The PNG's name. */
  name: string;
  /** The main window's size; 1440 × 900 by default. */
  viewport?: { width: number; height: number };
  /** Puts the app into the state to show; returns the page to take, the main window if none. */
  setup(page: Page, tools: SceneTools): Promise<Page | void>;
}

/** Shows a slide by clicking it, as the operator does. */
async function show(page: Page, text: string) {
  await page.getByText(text, { exact: false }).first().click();
}

export const SCENES: Scene[] = [
  {
    name: 'present',
    async setup(page, { content }) {
      await show(page, content.scenes.passage);
    },
  },
  {
    name: 'slideshow',
    async setup(page, tools) {
      await show(page, tools.content.scenes.song);
      return tools.slideshow();
    },
  },
  {
    name: 'slideshow-bible',
    async setup(page, tools) {
      await show(page, tools.content.scenes.passage);
      return tools.slideshow();
    },
  },
  {
    name: 'slideshow-bilingual',
    async setup(page, tools) {
      await show(page, tools.content.scenes.bilingual);
      return tools.slideshow();
    },
  },
  {
    name: 'calendar',
    async setup(page, { content, t }) {
      await page.getByRole('button', { name: t('nav.calendar'), exact: true }).click();
      await page.getByText(content.scenes.calendarSong).first().waitFor();
    },
  },
  {
    name: 'library',
    async setup(page, { content, t }) {
      await page.getByRole('button', { name: t('nav.songs'), exact: true }).click();
      await page.getByText(content.scenes.librarySong).first().click();
      await page.getByText(content.scenes.libraryLine).first().waitFor();
    },
  },
];

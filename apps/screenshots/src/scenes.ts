// The screenshots, each a page of the app put into a state worth showing. Find things the way
// a volunteer would, by their visible text, so a renamed button fails loudly here.

import type { Page } from 'playwright';

export interface SceneTools {
  /** Opens the slideshow window, showing what the main window last sent it. */
  slideshow(size?: { width: number; height: number }): Promise<Page>;
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
    async setup(page) {
      await show(page, 'A Psalm of David.');
    },
  },
  {
    name: 'slideshow',
    async setup(page, tools) {
      await show(page, 'Amazing grace! How sweet the sound');
      return tools.slideshow();
    },
  },
  {
    name: 'slideshow-bible',
    async setup(page, tools) {
      await show(page, 'A Psalm of David.');
      return tools.slideshow();
    },
  },
  {
    name: 'slideshow-bilingual',
    async setup(page, tools) {
      await show(page, 'Adeste fideles');
      return tools.slideshow();
    },
  },
  {
    name: 'calendar',
    async setup(page) {
      await page.getByRole('button', { name: 'Calendar', exact: true }).click();
      await page.getByText('Holy, Holy, Holy').first().waitFor();
    },
  },
  {
    name: 'library',
    async setup(page) {
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.getByText('Amazing Grace').first().click();
      await page.getByText('Through many dangers').first().waitFor();
    },
  },
];

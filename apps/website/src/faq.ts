// The questions on worship-q.com. The build writes them into the page and into its FAQPage
// structured data, so search engines and AI assistants quote the same answers people read.
// Plain text only: keep every answer true for the latest release.

import type { SiteLocale } from './locales.ts';
import { faq as hans } from './zh-hans.ts';
import { faq as hant } from './zh-hant.ts';

export interface Question {
  question: string;
  answer: string;
}

export const FAQ: Question[] = [
  {
    question: 'Is Worship Q free?',
    answer:
      'Yes. Worship Q is free and open source under the MIT licence, with no ads, no paid tier and no subscription. The public server it uses for phones, Bible passages and slides is free, and so is the church server.',
  },
  {
    question: 'Does it need an account or the internet?',
    answer:
      'No account, and no internet to plan and present on one computer. Phone control, Bible passages and slides from PowerPoint or PDF work through the free Worship Q public server, which needs the internet and keeps nothing. Running your church’s own server is optional and adds several computers sharing one presentation, songs and media shared between them, backups, and Bible versions that need a key.',
  },
  {
    question: 'Which computers does it run on?',
    answer:
      'macOS 11 or later (Apple Silicon and Intel) and 64-bit Windows 10 or later. Installed copies update themselves, never while the slideshow is open.',
  },
  {
    question: 'Can it show bilingual lyrics, such as Chinese and English, or more languages?',
    answer:
      'Yes. Lyrics in any language work, and bilingual or trilingual songs show a line and its translations on one slide: two lines by default, or more, such as Chinese, pinyin and English, by changing Lines per slide in Settings. Songs can be found by title or lyrics, and Chinese songs also by pinyin or initials.',
  },
  {
    question: 'How do I show a Bible passage?',
    answer:
      'Type a reference the way you would write it, such as Mark 15:5-6 or Mk 15.5-6, or browse by book and chapter, or search for words. Up to two versions are shown side by side on each slide. Without a church server, passages come through the free Worship Q public server, in the versions that need no key (for example KJV, BSB and the Chinese Union Version). A church server can also use the church’s own API.Bible, YouVersion or ESV key, for versions such as NIV, NKJV and ESV.',
  },
  {
    question: 'Can it show PowerPoint, Keynote, PDFs, photos and videos?',
    answer:
      'Yes. PowerPoint, Keynote and OpenDocument decks and PDFs become slides, and photos and videos go in the run sheet beside the songs. Without a church server, slides are made by the free Worship Q public server and kept on the computer, and videos stay on the computer. With one, every computer of the church has them, and videos are downloaded ahead of time, so nothing streams during the service.',
  },
  {
    question: 'Does it work with OBS for a live stream?',
    answer:
      'Yes. A subtitle overlay page shows the lyrics as a browser source in OBS, and Worship Q can switch OBS scenes and start or stop streaming and recording from any computer or phone of the church.',
  },
  {
    question: 'Can I control the slides from a phone?',
    answer:
      'Yes. A phone scans a QR code, is approved once, and can then move through the slides, change the run sheet and add Bible passages. Without a church server, two phones at a time connect through the free Worship Q public server, so the computer and the phones need the internet.',
  },
  {
    question: 'Can several computers share one presentation?',
    answer:
      'Yes. Computers connected to the church server show the same slide, any of them can take over, and if the presenting computer fails another carries on from the same slide. On the same Wi-Fi they keep working together without internet.',
  },
  {
    question: 'What is the Worship Q public server, and what does it keep?',
    answer:
      'A free server run by the Worship Q project, which every computer without a church server uses by itself for phone control, Bible passages, slides and live audio. There is nothing to set up or sign in to. It keeps nothing: a slide deck is deleted as soon as the computer has its slides, and anything else within a day; songs, run sheets and recordings never go there. So it is one computer’s helper, not a home for a church’s content.',
  },
  {
    question: 'Why would a church still run its own server?',
    answer:
      'To share: several computers presenting together, songs, run sheets, slides and videos on every computer of the church, the Church Library, off-site backups, browser outputs for a streaming laptop, Bible versions that need a key such as NIV and ESV, recordings of live audio, and an admin app. A computer that joins later brings its slides and videos with it.',
  },
  {
    question: 'Can I import songs from ProPresenter, EasyWorship or OpenLP?',
    answer:
      'Not yet. For now, paste the lyrics of each song as text, with a blank line between sections; Worship Q splits them into slides. If your church would like to move over and needs an import, email hello@ihs.technology to talk about it. Pull requests are welcome too at github.com/iphren/worship-q.',
  },
];

/** The questions in each of the site's languages. */
export const FAQS: Record<SiteLocale, Question[]> = { en: FAQ, 'zh-hans': hans, 'zh-hant': hant };

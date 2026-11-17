// The questions on worship-q.com. The build writes them into the page and into its FAQPage
// structured data, so search engines and AI assistants quote the same answers people read.
// Plain text only: keep every answer true for the latest release.

export interface Question {
  question: string;
  answer: string;
}

export const FAQ: Question[] = [
  {
    question: 'Is Worship Q free?',
    answer:
      'Yes. Worship Q is free and open source under the MIT licence, with no ads, no paid tier and no subscription. The church server is free too.',
  },
  {
    question: 'Does it need an account or the internet?',
    answer:
      'No. The desktop app works on its own on one computer, with no account and no internet. Connecting to a church server is optional and adds shared songs, slides and videos, Bible passages, phone control and several computers sharing one presentation.',
  },
  {
    question: 'Which computers does it run on?',
    answer:
      'macOS 11 or later (Apple Silicon and Intel) and 64-bit Windows 10 or later. Installed copies update themselves, never while the slideshow is open.',
  },
  {
    question: 'Can it show lyrics in two languages, such as Chinese and English?',
    answer:
      'Yes. Lyrics in any language work, and a line in one language followed by the same line in another share a slide. Songs can be found by title or lyrics, and Chinese songs also by pinyin or initials.',
  },
  {
    question: 'How do I show a Bible passage?',
    answer:
      'Type a reference the way you would write it, such as Mark 15:5-6 or Mk 15.5-6, or browse by book and chapter, or search for words. Up to two versions are shown side by side on each slide. Passages come through the church server, which can use the keyless Free Use Bible API (for example KJV, BSB and the Chinese Union Version) or the church’s own API.Bible or YouVersion key.',
  },
  {
    question: 'Can it show PowerPoint, Keynote, PDFs, photos and videos?',
    answer:
      'Yes, with a church server. PowerPoint, Keynote and OpenDocument decks and PDFs become slides, and photos and videos go in the run sheet beside the songs. Videos are downloaded ahead of time, so nothing streams during the service.',
  },
  {
    question: 'Does it work with OBS for a live stream?',
    answer:
      'Yes. A subtitle overlay page shows the lyrics as a browser source in OBS, and Worship Q can switch OBS scenes and start or stop streaming and recording from any computer or phone of the church.',
  },
  {
    question: 'Can I control the slides from a phone?',
    answer:
      'Yes, with a church server. A phone scans a QR code, is approved once, and can then move through the slides, change the run sheet and add Bible passages.',
  },
  {
    question: 'Can several computers share one presentation?',
    answer:
      'Yes. Computers connected to the church server show the same slide, any of them can take over, and if the presenting computer fails another carries on from the same slide. On the same Wi-Fi they keep working together without internet.',
  },
  {
    question: 'Can I import songs from ProPresenter, EasyWorship or OpenLP?',
    answer:
      'Not yet. For now, paste the lyrics of each song as text, with a blank line between sections; Worship Q splits them into slides. If your church would like to move over and needs an import, email hello@ihs.technology to talk about it. Pull requests are welcome too at github.com/iphren/worship-q.',
  },
];

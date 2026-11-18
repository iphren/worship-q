// The site in Markdown, for AI assistants and agents: llms.txt (the llmstxt.org convention),
// llms-full.txt (everything in one file) and index.md (the home page, in each language).
// Built from the same content as the page, so the two never disagree. llms.txt and
// llms-full.txt are in English only.

import { CONTENT, FEATURES, PLATFORMS, SUMMARY } from './content.ts';
import { FAQ, FAQS } from './faq.ts';
import { HOME } from './home.ts';
import { REPO_URL, SITE } from './layout.ts';
import { localePath, type SiteLocale } from './locales.ts';
import { PAGES } from './pages.ts';
import { WORDS } from './words.ts';

/** What the build knows about the release the download buttons serve. */
export interface ReleaseFacts {
  version: string | null;
  /** The release date as written on the page, such as `17 November 2026`. */
  date: string | null;
  notesUrl: string;
  macUrl: string;
  windowsUrl: string;
}

const docUrl = (file: string) => `${REPO_URL}/blob/main/docs/${file}`;

function download(release: ReleaseFacts): string {
  const version = release.version
    ? `Version ${release.version}${release.date ? `, released ${release.date}` : ''}. `
    : '';
  return [
    `- [Download for Mac](${release.macUrl}): ${PLATFORMS.mac}`,
    `- [Download for Windows](${release.windowsUrl}): ${PLATFORMS.windows}`,
    '',
    `${version}[Release notes](${release.notesUrl}). Installed copies update themselves, never while the slideshow is open.`,
    '',
    'The Mac app is signed and notarized. The Windows app is not yet signed with Microsoft, so the first time it opens Windows may show "Windows protected your PC": choose More info, then Run anyway.',
  ].join('\n');
}

const features = () => FEATURES.map((f) => `- **${f.title}.** ${f.text}`).join('\n');

const questions = () => FAQ.map((q) => `### ${q.question}\n\n${q.answer}`).join('\n\n');

/** llms.txt: what Worship Q is, and where to read more. */
export function llmsTxt(release: ReleaseFacts): string {
  return `# Worship Q

> ${SUMMARY}

Worship Q is made for churches: volunteers plan each week's run sheet on a calendar and present songs, Bible passages, slide decks, photos and videos on the projector, with a subtitle overlay for the live stream in OBS. It works on one computer with no account, and with no internet to plan and present. Phone remote control, Bible passages and slides work through a free Worship Q public server, which keeps nothing. A church can also run its own free Worship Q server, which adds several computers sharing one presentation, songs and media shared between them, backups, and Bible versions that need a key. It is free, with no ads or subscription, under the MIT licence.

Good fit for: churches looking for free church presentation or worship lyrics software for Mac or Windows; churches singing bilingual or multilingual lyrics, such as Chinese and English, on one slide; churches streaming services with OBS; free alternatives to ProPresenter, EasyWorship or OpenLP.

## Download

${download(release)}

## Docs

- [Worship Q home page in Markdown](${SITE}/index.md): features, download and questions
- [Everything in one file](${SITE}/llms-full.txt): this file, the features, the questions and the volunteer guide
${PAGES.map((page) => `- [${page.title.replace(/ — Worship Q$/, '')}](${SITE}${page.path}index.md): ${page.description}`).join('\n')}

## Optional

- [Source code](${REPO_URL}): MIT licence
- [All releases](${REPO_URL}/releases)
- [Requirements and architecture](${docUrl('worship-q-requirements-and-architecture.md')})
`;
}

/** llms-full.txt: llms.txt, then the features, the questions and the volunteer guide in full. */
export function llmsFullTxt(release: ReleaseFacts, volunteerGuide: string): string {
  // The guide's own headings move down one level, under this file's heading for it.
  const guide = volunteerGuide
    .trim()
    .replace(/^# .*\n+/, '')
    .replace(/^(#+) /gm, '#$1 ');
  return `${llmsTxt(release)}
## Features

${features()}

## Questions

${questions()}

## Volunteer guide

Source: ${SITE}/guide/

${guide}
`;
}

/** index.md: the home page in Markdown, in a language. */
export function indexMd(release: ReleaseFacts, locale: SiteLocale = 'en'): string {
  if (locale === 'en')
    return `# Worship Q: free church presentation software for lyrics, Bible and slides

${SUMMARY} Plan each week's run sheet and present it, with no account and no internet needed.

## Download

${download(release)}

## What it does

${features()}

## Questions

${questions()}

## More

- [Screenshots](${SITE}/#screenshots)
- [Volunteer guide](${SITE}/guide/)
- [Church server setup](${SITE}/server/)
- [Compared with other church presentation software](${SITE}/compare/)
- [Source code](${REPO_URL})
`;
  const words = WORDS[locale];
  const md = words.markdown;
  const { summary, features: list, platforms } = CONTENT[locale];
  const home = HOME[locale];
  const url = (path: string) => `${SITE}${localePath(locale, path)}`;
  const version = release.version
    ? `${md.version.replace('{version}', release.version).replace('{date}', release.date ?? '')} `
    : '';
  return `# ${home.title.replace(/^Worship Q — /, 'Worship Q：')}

${summary}

## ${md.download}

- [${md.macDownload}](${release.macUrl})：${platforms.mac}
- [${md.windowsDownload}](${release.windowsUrl})：${platforms.windows}

${version}[${md.notes}](${release.notesUrl})。${md.updates}

${md.windowsWarning}

## ${md.whatItDoes}

${list.map((f) => `- **${f.title}。** ${f.text}`).join('\n')}

## ${md.questions}

${FAQS[locale].map((q) => `### ${q.question}\n\n${q.answer}`).join('\n\n')}

## ${md.more}

- [${md.screenshots}](${url('/')}#screenshots)
- [${words.footer.guide}](${url('/guide/')})
- [${words.footer.server}](${url('/server/')})
- [${md.compare}](${url('/compare/')})
- [${md.source}](${REPO_URL})
`;
}

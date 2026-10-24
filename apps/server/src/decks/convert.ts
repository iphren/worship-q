/**
 * Turns a slide deck into images that fit the screen, one per click, plus each image's
 * text for phones and search.
 *
 * PowerPoint files are expanded into one slide per click (see `expandPptx`), laid out by
 * LibreOffice into a PDF, and drawn page by page by Ghostscript. Other presentation formats
 * are first converted to PowerPoint by LibreOffice, so their animations count too. A PDF
 * is drawn as it is.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { expandPptx, type DeckPage } from './pptx';

const run = promisify(execFile);

export const DECK_EXTENSIONS = [
  '.pptx',
  '.ppsx',
  '.pptm',
  '.potx',
  '.ppt',
  '.pps',
  '.odp',
  '.key',
  '.pdf',
];
const OOXML = ['.pptx', '.ppsx', '.pptm', '.potx'];

export interface ConvertOptions {
  soffice: string;
  ghostscript: string;
  /** A folder for intermediate files, emptied first. */
  workDir: string;
  /** LibreOffice's settings folder, kept between conversions so it starts faster. */
  profileDir?: string;
  maxWidth?: number;
  maxHeight?: number;
  jpegQuality?: number;
}

export interface ConvertedPage extends DeckPage {
  image: string;
  /** A small copy of the image, for phones. */
  thumbnail: string;
}

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 240;

export interface ConvertedDeck {
  pages: ConvertedPage[];
  width: number;
  height: number;
}

/**
 * On macOS, LibreOffice without a screen finds only the fonts it brings, so slides fall back
 * to other fonts and text wraps differently. This points it at the system's fonts.
 */
async function fontEnvironment(workDir: string): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'darwin' || process.env.FONTCONFIG_FILE) return process.env;
  const home = process.env.HOME ?? '';
  const config = join(workDir, 'fonts.conf');
  await writeFile(
    config,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/System/Library/Fonts</dir>
  <dir>/Library/Fonts</dir>
  <dir>${home}/Library/Fonts</dir>
  <cachedir>${join(workDir, 'font-cache')}</cachedir>
</fontconfig>
`,
  );
  return { ...process.env, FONTCONFIG_FILE: config };
}

async function soffice(options: ConvertOptions, format: string, input: string, outDir: string) {
  const env = await fontEnvironment(options.workDir);
  await run(
    options.soffice,
    [
      '--headless',
      '--norestore',
      `-env:UserInstallation=file://${options.profileDir ?? join(options.workDir, 'profile')}`,
      '--convert-to',
      format,
      '--outdir',
      outDir,
      input,
    ],
    { env, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
  );
  const output = join(outDir, `${basename(input, extname(input))}.${format}`);
  await readFile(output).catch(() => {
    throw new Error(`LibreOffice could not convert ${basename(input)}.`);
  });
  return output;
}

/** The size of a PDF's first page, in points. */
async function pdfPageSize(options: ConvertOptions, pdf: string) {
  const { stdout } = await run(options.ghostscript, [
    '-q',
    '-dNODISPLAY',
    '-dNOSAFER',
    '-dNOPAUSE',
    '-dBATCH',
    '-c',
    `(${pdf}) (r) file runpdfbegin 1 pdfgetpage /MediaBox pget pop == quit`,
  ]);
  const [x0, y0, x1, y1] = (stdout.match(/-?[\d.]+/g) ?? []).map(Number);
  if ([x0, y0, x1, y1].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error('Could not read the size of the PDF’s pages.');
  }
  return { width: x1! - x0!, height: y1! - y0! };
}

async function pdfText(options: ConvertOptions, pdf: string, count: number): Promise<string[][]> {
  const dir = join(options.workDir, 'text');
  await mkdir(dir, { recursive: true });
  await run(options.ghostscript, [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=txtwrite',
    '-o',
    join(dir, '%03d.txt'),
    pdf,
  ]);
  const pages: string[][] = [];
  for (let i = 1; i <= count; i++) {
    const text = await readFile(join(dir, `${String(i).padStart(3, '0')}.txt`), 'utf8').catch(
      () => '',
    );
    pages.push(
      text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
  }
  return pages;
}

export async function convertDeck(
  input: string,
  outDir: string,
  options: ConvertOptions,
): Promise<ConvertedDeck> {
  const extension = extname(input).toLowerCase();
  if (!DECK_EXTENSIONS.includes(extension))
    throw new Error(`${extension} files are not supported.`);
  await rm(options.workDir, { recursive: true, force: true });
  await mkdir(options.workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  let pdf = input;
  let pages: DeckPage[] | null = null;
  let size: { width: number; height: number };
  if (extension !== '.pdf') {
    let pptx = input;
    if (!OOXML.includes(extension)) pptx = await soffice(options, 'pptx', input, options.workDir);
    const expanded = expandPptx(await readFile(pptx));
    const expandedPath = join(options.workDir, 'deck.pptx');
    await writeFile(expandedPath, expanded.pptx);
    pdf = await soffice(options, 'pdf', expandedPath, options.workDir);
    pages = expanded.pages;
    // EMU to points.
    size = { width: expanded.width / 12700, height: expanded.height / 12700 };
  } else {
    size = await pdfPageSize(options, pdf);
  }

  const fit = (width: number, height: number) =>
    Math.min((width / size.width) * 72, (height / size.height) * 72);
  const dpi = fit(options.maxWidth ?? 1920, options.maxHeight ?? 1080);
  for (const old of await readdir(outDir)) {
    if (/^(t-)?\d+\.jpg$/.test(old)) await rm(join(outDir, old));
  }
  const render = (resolution: number, quality: number, pattern: string) =>
    run(
      options.ghostscript,
      [
        '-q',
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        '-sDEVICE=jpeg',
        `-dJPEGQ=${quality}`,
        `-r${resolution.toFixed(3)}`,
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        '-o',
        join(outDir, pattern),
        pdf,
      ],
      { timeout: 300_000 },
    );
  await render(dpi, options.jpegQuality ?? 85, '%03d.jpg');
  // Small copies for phones, which fetch them over the venue's connection.
  await render(fit(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), 75, 't-%03d.jpg');
  const images = (await readdir(outDir)).filter((f) => /^\d+\.jpg$/.test(f)).sort();
  if (!pages || pages.length !== images.length) {
    // A PDF, or LibreOffice laid out a different number of slides than expected.
    const text = await pdfText(options, pdf, images.length);
    pages = images.map((_, i) => ({ slide: i + 1, step: 0, text: text[i] ?? [] }));
  }
  return {
    pages: pages.map((page, i) => ({ ...page, image: images[i]!, thumbnail: `t-${images[i]!}` })),
    width: Math.round((size.width / 72) * dpi),
    height: Math.round((size.height / 72) * dpi),
  };
}

export interface DeckTools {
  soffice: string;
  ghostscript: string;
}

/** Where LibreOffice and Ghostscript are expected, unless set in the environment. */
export function deckTools(): DeckTools {
  return {
    soffice:
      process.env.WORSHIP_Q_SOFFICE ??
      (process.platform === 'darwin'
        ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        : 'soffice'),
    ghostscript: process.env.WORSHIP_Q_GHOSTSCRIPT ?? 'gs',
  };
}

/** Whether both tools can be run, so slide decks can be converted. */
export async function deckToolsAvailable(tools: DeckTools): Promise<boolean> {
  try {
    await run(tools.ghostscript, ['--version'], { timeout: 10_000 });
    await run(tools.soffice, ['--version'], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

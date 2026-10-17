/**
 * Song search keys: lets people find a song by Chinese text in either script, by pinyin, or by
 * the initials of the pinyin (耶和华 → yehehua, yhh), with homophones matching on purpose.
 *
 * Text is folded first: compatibility forms, letter case and Latin accents are normalized,
 * Traditional characters become Simplified, and 祢/祂 become 你/他. Only word characters
 * (letters, digits, Chinese characters) are kept; spaces and punctuation are ignored.
 *
 * Keys are derived data: every client generates them with this package, so they always agree.
 */
import { Converter } from 'opencc-js/t2cn';
import { customPinyin, pinyin } from 'pinyin-pro';
import { PHRASE_READINGS, SINGLE_READINGS } from './readings';

/** Bump whenever the keys a text produces change, so stored keys are rebuilt. */
export const SEARCH_VERSION = 1;

export interface SearchKeys {
  /** Folded word characters, without separators. */
  text: string;
  /** Chinese characters as toneless pinyin, with other words as they are. */
  pinyin: string;
  /** First letter of every Chinese syllable and of every other word. */
  initials: string;
}

export interface QueryTerm {
  /** Whether the term contains Chinese characters. */
  chinese: boolean;
  /** Folded term, matched against `SearchKeys.text`. */
  text: string;
  /** Pinyin of the term, matched against `SearchKeys.pinyin`. */
  pinyin: string;
}

const toSimplified = Converter({ from: 'tw', to: 'cn' });

/** Forms used in worship songs that mean the same as a common character. */
const VARIANTS: Record<string, string> = { 祢: '你', 妳: '你', 祂: '他' };
const VARIANT_PATTERN = new RegExp(`[${Object.keys(VARIANTS).join('')}]`, 'g');

customPinyin(PHRASE_READINGS);

const HAN = /\p{Script=Han}/u;
/** A run of Chinese characters, or a run of other letters and digits. */
const TOKEN = /\p{Script=Han}+|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu;
const APOSTROPHES = /['’]/g;

export function fold(text: string): string {
  const normalized = text
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFKC')
    .toLowerCase();
  return toSimplified(normalized).replace(VARIANT_PATTERN, (char) => VARIANTS[char] ?? char);
}

/** Folded tokens; apostrophes are dropped so "you're" stays one word. */
function tokens(text: string): string[] {
  return fold(text).replace(APOSTROPHES, '').match(TOKEN) ?? [];
}

function syllables(run: string): string[] {
  if (run.length === 1 && SINGLE_READINGS[run]) return [SINGLE_READINGS[run]];
  return pinyin(run, { toneType: 'none', type: 'array', v: true });
}

export function searchKeys(text: string): SearchKeys {
  const keys: SearchKeys = { text: '', pinyin: '', initials: '' };
  for (const token of tokens(text)) {
    keys.text += token;
    if (HAN.test(token)) {
      for (const syllable of syllables(token)) {
        keys.pinyin += syllable;
        keys.initials += syllable[0] ?? '';
      }
    } else {
      keys.pinyin += token;
      keys.initials += /^\p{N}+$/u.test(token) ? token : token[0];
    }
  }
  return keys;
}

/**
 * Splits a search into terms; anything that is not a word character separates terms. Every
 * term must match somewhere in the song.
 */
export function parseQuery(input: string): QueryTerm[] {
  return input
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((word) => searchKeys(word))
    .filter((keys) => keys.text !== '')
    .map((keys) => ({ chinese: HAN.test(keys.text), text: keys.text, pinyin: keys.pinyin }));
}

/** Keys stored for one song. */
export interface SongKeys {
  title: SearchKeys;
  lyrics: SearchKeys;
}

export function songKeys(song: { title: string; lyrics: string }): SongKeys {
  return { title: searchKeys(song.title), lyrics: searchKeys(song.lyrics) };
}

/**
 * How well a term matches, lower is better: in the title before in the lyrics; within each,
 * the same characters before the same sound, before the initials. A match at the start of the
 * title comes first. Returns null when the term does not match.
 */
export function rankTerm(term: QueryTerm, keys: SongKeys): number | null {
  const tiers: [string, string][] = term.chinese
    ? [
        [keys.title.text, term.text],
        [keys.title.pinyin, term.pinyin],
        [keys.lyrics.text, term.text],
        [keys.lyrics.pinyin, term.pinyin],
      ]
    : [
        [keys.title.pinyin, term.pinyin],
        [keys.title.initials, term.pinyin],
        [keys.lyrics.pinyin, term.pinyin],
        [keys.lyrics.initials, term.pinyin],
      ];
  const atStart = term.chinese
    ? keys.title.text.startsWith(term.text)
    : keys.title.pinyin.startsWith(term.pinyin) || keys.title.initials.startsWith(term.pinyin);
  if (atStart) return 0;
  const index = tiers.findIndex(([haystack, needle]) => haystack.includes(needle));
  return index === -1 ? null : index + 1;
}

/** Overall rank of a song for a search, lower is better; null when a term does not match. */
export function rankSong(terms: readonly QueryTerm[], keys: SongKeys): number | null {
  let total = 0;
  for (const term of terms) {
    const rank = rankTerm(term, keys);
    if (rank === null) return null;
    total += rank;
  }
  return total;
}

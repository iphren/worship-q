/**
 * Worship Q's versions (B18): each names one edition, its language, and the providers that
 * serve it in fallback order with their own identifiers. Fallback only ever moves between
 * the providers listed for one version, so it never changes the edition.
 */
import type { BibleLanguage } from './books';
import type { Provider } from './passage';

export interface ProviderEntry {
  provider: Provider;
  /** The provider's identifier for the version. */
  id: string;
  /**
   * For API.Bible, an id given as `abbr:NLT` is looked up by its abbreviation in the list of
   * Bibles the church's key may use, since that list differs between plans and countries.
   */
}

export interface CatalogueVersion {
  /** Worship Q's id, stored with passages and in settings. */
  id: string;
  /** The edition's full name. */
  name: string;
  /**
   * The short name shown on chips, in the admin app and at the foot of each column on the
   * slide; Chinese editions say their script. Never stored as an id, so it can change.
   */
  credit: string;
  language: BibleLanguage;
  providers: ProviderEntry[];
}

export const CATALOGUE: readonly CatalogueVersion[] = [
  {
    id: 'NIVUK',
    name: 'New International Version (Anglicised)',
    credit: 'NIV (UK)',
    language: 'en',
    providers: [
      { provider: 'youversion', id: '113' },
      { provider: 'apibible', id: '3e2eb613d45e131e-01' },
    ],
  },
  {
    id: 'NKJV',
    name: 'New King James Version',
    credit: 'NKJV',
    language: 'en',
    providers: [{ provider: 'apibible', id: '63097d2a0a2f7db3-01' }],
  },
  {
    id: 'NLT',
    name: 'New Living Translation',
    credit: 'NLT',
    language: 'en',
    providers: [{ provider: 'apibible', id: 'abbr:NLT' }],
  },
  {
    id: 'ESV',
    name: 'English Standard Version',
    credit: 'ESV',
    language: 'en',
    providers: [{ provider: 'esv', id: 'ESV' }],
  },
  {
    id: 'KJV',
    name: 'King James Version',
    credit: 'KJV',
    language: 'en',
    providers: [
      { provider: 'apibible', id: 'de4e12af7f28f599-01' },
      { provider: 'freeuse', id: 'eng_kjv' },
    ],
  },
  {
    id: 'BSB',
    name: 'Berean Standard Bible',
    credit: 'BSB',
    language: 'en',
    providers: [
      { provider: 'youversion', id: '3034' },
      { provider: 'freeuse', id: 'BSB' },
    ],
  },
  {
    id: 'CUNP-S',
    name: '新标点和合本（简体）',
    credit: '和合本（简）',
    language: 'zh-Hans',
    providers: [{ provider: 'freeuse', id: 'cmn_cu1' }],
  },
  {
    id: 'CUNP-T',
    name: '新標點和合本（繁體）',
    credit: '和合本（繁）',
    language: 'zh-Hant',
    providers: [{ provider: 'freeuse', id: 'cmn_cuv' }],
  },
  {
    id: 'CCB',
    name: '当代译本（简体）',
    credit: '当代译本（简）',
    language: 'zh-Hans',
    providers: [
      { provider: 'youversion', id: '36' },
      { provider: 'apibible', id: '7ea794434e9ea7ee-01' },
      { provider: 'freeuse', id: 'cmn_cbs' },
    ],
  },
  {
    id: 'CCBT',
    name: '當代譯本（繁體）',
    credit: '當代譯本（繁）',
    language: 'zh-Hant',
    providers: [
      { provider: 'youversion', id: '1392' },
      { provider: 'freeuse', id: 'cmn_cbt' },
    ],
  },
  {
    id: 'CSBS',
    name: '中文标准译本（简体）',
    credit: '中文标准译本（简）',
    language: 'zh-Hans',
    providers: [
      { provider: 'youversion', id: '43' },
      { provider: 'freeuse', id: 'cmn_csbs' },
    ],
  },
  {
    id: 'CSBT',
    name: '中文標準譯本（繁體）',
    credit: '中文標準譯本（繁）',
    language: 'zh-Hant',
    providers: [
      { provider: 'youversion', id: '312' },
      { provider: 'freeuse', id: 'cmn_csbt' },
    ],
  },
];

const BY_ID = new Map(CATALOGUE.map((version) => [version.id, version]));

export function catalogueVersion(id: string): CatalogueVersion | undefined {
  return BY_ID.get(id);
}

/** The prefix of an API.Bible id looked up by abbreviation. */
export const BY_ABBREVIATION = 'abbr:';

/** At most this many versions are shown side by side (B5). */
export const MAX_WORKSPACE_VERSIONS = 2;

/**
 * A workspace's chosen versions as they apply (B4, B19): in the chosen order, only those the
 * church still offers, each once, at most two. A choice no longer offered is left out here
 * and shown greyed where the setting is edited.
 */
export function effectiveVersions(chosen: readonly string[], offered: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of chosen) {
    if (offered.includes(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_WORKSPACE_VERSIONS) break;
  }
  return out;
}

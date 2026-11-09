/** What the church server answers about the Bible (B17–B26). */
import type { BibleLanguage, PassageText, Provider, Toc } from '@worship-q/bible';

/** A version the church offers, as devices are told it. */
export interface BibleVersionInfo {
  id: string;
  name: string;
  credit: string;
  language: BibleLanguage;
}

/** `GET /api/v1/bible/versions` */
export interface BibleVersionsResponse {
  versions: BibleVersionInfo[];
}

/** `GET /api/v1/bible/:version/toc`; `hash` changes whenever the contents do. */
export interface BibleTocResponse {
  toc: Toc;
  hash: string;
}

/** `GET /api/v1/bible/:version/passage?ref=` */
export interface BiblePassageResponse {
  reference: string;
  text: PassageText;
}

/** `GET /api/v1/bible/:version/search?q=` */
export interface BibleSearchResponse {
  /** USFM references, best first, up to 20. */
  references: string[];
  /** False when no provider searches this version. */
  searched: boolean;
}

/** Why the server could not answer a Bible request. */
export type BibleErrorCode = 'not-offered' | 'not-found' | 'too-large' | 'unavailable';

/** `GET /api/v1/admin/bible`: which keys are set (never the keys), and every version. */
export interface AdminBible {
  keys: { youversion: boolean; apibible: boolean; esv: boolean };
  /** False until the first availability check has finished. */
  checked: boolean;
  versions: (BibleVersionInfo & {
    available: boolean;
    providers: Provider[];
    offered: boolean;
  })[];
}

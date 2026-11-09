/**
 * A passage in the one normalised shape every provider fills (B22) and a run sheet item
 * stores (B23): verse units with their lines, per version, with the copyright line.
 */
import { z } from 'zod';
import { fromUsfm, type Reference } from './reference';

export const PassageLineSchema = z.object({
  text: z.string(),
  /** Poetry's indent, 0 or 1; prose is 0. */
  indent: z.number().int().min(0).max(3),
});
export type PassageLine = z.infer<typeof PassageLineSchema>;

/**
 * A verse, a group of verses the version prints as one (`12-13`), or a psalm's title, which
 * has no verses and comes before verse 1.
 */
export const PassageUnitSchema = z.object({
  chapter: z.number().int().min(1),
  /** The verses it covers, in order; empty for a title. */
  verses: z.array(z.number().int().min(1)),
  /** The number printed: `12`, `12-13`; empty for a title. */
  label: z.string(),
  title: z.boolean().optional(),
  lines: z.array(PassageLineSchema),
});
export type PassageUnit = z.infer<typeof PassageUnitSchema>;

export const PROVIDERS = ['youversion', 'apibible', 'esv', 'freeuse'] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

/** One version's text of a passage. */
export const PassageTextSchema = z.object({
  /** Worship Q's version id, such as `NIVUK`. */
  version: z.string().min(1),
  /** The short credit shown at the foot of the column, such as `NIVUK` or `当代译本`. */
  credit: z.string(),
  /** The provider that served it. */
  provider: ProviderSchema,
  /** The provider's copyright line. */
  copyright: z.string(),
  units: z.array(PassageUnitSchema),
  /** API.Bible's usage token, reported when the text is shown (B25). */
  fumsToken: z.string().nullable().default(null),
});
export type PassageText = z.infer<typeof PassageTextSchema>;

export const MAX_PASSAGE_VERSIONS = 2;

/** A passage as a run sheet item stores it: the reference, and up to two versions' text. */
export const PassageSchema = z.object({
  /** USFM, as `toUsfm` writes it. */
  reference: z.string().refine((usfm) => fromUsfm(usfm) !== null, 'Not a USFM reference'),
  texts: z.array(PassageTextSchema).min(1).max(MAX_PASSAGE_VERSIONS),
});
export type Passage = z.infer<typeof PassageSchema>;

/** The passage's reference; null only for a passage that failed validation. */
export function passageReference(passage: Pick<Passage, 'reference'>): Reference | null {
  return fromUsfm(passage.reference);
}

/** A passage as plain text, for devices that know only lyrics, and for search. */
export function passagePlainText(passage: Passage): string {
  const text = passage.texts[0];
  if (!text) return '';
  return text.units
    .map((unit) =>
      unit.lines
        .map((line, i) => (i === 0 && unit.label ? `${unit.label} ${line.text}` : line.text))
        .join('\n'),
    )
    .join('\n\n');
}

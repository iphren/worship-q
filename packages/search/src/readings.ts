/**
 * Readings for characters with several pronunciations (多音字), where the general-purpose
 * dictionary picks one that is unusual in worship songs. Add to these lists when a search
 * misses, and bump SEARCH_VERSION so every device rebuilds its index.
 */

/** Phrases read differently from the dictionary's choice, as toneless syllables. */
export const PHRASE_READINGS: Record<string, string> = {
  得着: 'de zhao',
  降服: 'xiang fu',
  降伏: 'xiang fu',
};

/**
 * Readings for a character that stands alone, with no neighbours to give it context. Only
 * characters whose dictionary default differs from the usual reading in worship songs are
 * listed; for example 乐 (le), 行 (xing), 长 (chang), 重 (zhong) and 和 (he) already default
 * to the reading wanted.
 */
export const SINGLE_READINGS: Record<string, string> = {
  了: 'le',
};

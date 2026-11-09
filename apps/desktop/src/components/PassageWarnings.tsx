import { align, describeWarning, type Passage, type Song } from '@worship-q/protocol';
import { useMemo } from 'react';

/** The operator's notes on a passage's joined and missing verses, never shown on screen (B16). */
export function passageWarnings(passage: Passage): string[] {
  try {
    const aligned = align(passage);
    return aligned.warnings.map((warning) => describeWarning(warning, aligned.reference.book));
  } catch {
    return [];
  }
}

/** A passage item's warnings, under its title in the run sheet (P5.3). */
export function PassageWarnings(props: { song: Pick<Song, 'passage'>; className?: string }) {
  const { passage } = props.song;
  const warnings = useMemo(() => (passage ? passageWarnings(passage) : []), [passage]);
  if (warnings.length === 0) return null;
  return (
    <span className={`block text-xs text-slate-400 ${props.className ?? ''}`}>
      {warnings.map((warning) => (
        <span key={warning} className="block truncate" title={warning}>
          ⓘ {warning}
        </span>
      ))}
    </span>
  );
}

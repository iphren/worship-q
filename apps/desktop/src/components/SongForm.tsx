import { assignLineIds, buildPieces } from '@worship-q/lyrics';
import type { Song } from '@worship-q/protocol';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useSession } from '../app/context';
import { t } from '../i18n';

export interface SongDraft {
  title: string;
  author: string;
  copyright: string;
  lyrics: string;
}

const draftOf = (song: Song | null): SongDraft => ({
  title: song?.title ?? '',
  author: song?.author ?? '',
  copyright: song?.copyright ?? '',
  lyrics: song?.lyrics ?? '',
});

/**
 * Song editor with a side preview of the generated slides. Used for the library and for
 * fixing lyrics during a presentation. Give it a `key` so it resets when the song changes.
 */
export function SongForm(props: {
  song: Song | null;
  /** Hide everything but the lyrics, for quick fixes while live. */
  lyricsOnly?: boolean;
  onSaved(song: Song): void;
  onDirtyChange?(dirty: boolean): void;
  actions?: ReactNode;
}) {
  const session = useSession();
  const { song, onDirtyChange } = props;
  const [draft, setDraft] = useState(() => draftOf(song));
  const [saving, setSaving] = useState(false);
  const settings = useQuery(() => session.store.getPresentationSettings(session.workspace.id), []);
  const linesPerPiece = settings?.linesPerPiece ?? 2;

  const saved = draftOf(song);
  const dirty = (Object.keys(saved) as (keyof SongDraft)[]).some(
    (key) => saved[key] !== draft[key],
  );
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const pieces = useMemo(() => {
    let n = 0;
    const ids = assignLineIds(null, draft.lyrics, () => `preview-${n++}`);
    return buildPieces(draft.lyrics, ids, linesPerPiece);
  }, [draft.lyrics, linesPerPiece]);

  const canSave = dirty && !saving && (draft.title.trim() !== '' || draft.lyrics.trim() !== '');
  const set = (patch: Partial<SongDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      // An untitled song takes its first lyric line as its title.
      const title = draft.title.trim() || pieces[0]?.lines[0]?.text.trim() || t('songs.untitled');
      const fields = { ...draft, title };
      const result = song
        ? await session.saveSong(song.id, fields)
        : await session.createSong(fields);
      setDraft(draftOf(result));
      props.onSaved(result);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex h-full min-h-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault();
          void save();
        }
      }}
    >
      {!props.lyricsOnly && (
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="label">{t('songs.title')}</span>
            <input
              className="field"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              autoFocus={!song}
            />
          </label>
          <label>
            <span className="label">{t('songs.author')}</span>
            <input
              className="field"
              value={draft.author}
              onChange={(e) => set({ author: e.target.value })}
            />
          </label>
          <label>
            <span className="label">{t('songs.copyright')}</span>
            <input
              className="field"
              value={draft.copyright}
              onChange={(e) => set({ copyright: e.target.value })}
            />
          </label>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <label className="flex min-h-0 flex-col">
          <span className="label">{t('songs.lyrics')}</span>
          <textarea
            className="field min-h-64 flex-1 resize-none leading-relaxed"
            value={draft.lyrics}
            onChange={(e) => set({ lyrics: e.target.value })}
            spellCheck={false}
            autoFocus={props.lyricsOnly}
          />
          <span className="mt-1 text-xs text-slate-500">
            {t('songs.lyricsHint', { count: linesPerPiece })}
          </span>
        </label>
        <div className="flex min-h-0 flex-col">
          <span className="label">
            {t('songs.preview')} · {t('songs.pieceCount', { count: pieces.length })}
          </span>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md border border-slate-700 bg-slate-900/60 p-2">
            {pieces.length === 0 && (
              <p className="p-2 text-sm text-slate-500">{t('songs.previewEmpty')}</p>
            )}
            {pieces.map((piece, index) => (
              <div
                key={piece.id}
                className={`rounded-md bg-slate-800 px-3 py-2 text-center text-sm ${
                  piece.indexInBlock === 0 && index > 0 ? 'mt-4' : ''
                }`}
              >
                {piece.lines.map((line) => (
                  <div key={line.id} className="whitespace-pre-wrap">
                    {line.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {props.actions}
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

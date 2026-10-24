import { assignLineIds, buildPieces } from '@worship-q/lyrics';
import {
  cleanSongFields,
  invalidSongFields,
  maxSongYear,
  type Deck,
  type Song,
  type SongBackground,
} from '@worship-q/protocol';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { SongBackgroundFields } from './BackgroundPicker';
import { SlideImage } from './SlideImage';
import { useScrollMemory } from '../lib/scrollMemory';

export interface SongDraft {
  title: string;
  author: string;
  copyright: string;
  ccli: string;
  year: string;
  lyrics: string;
  background: SongBackground | null;
}

type Tab = 'lyrics' | 'copyright' | 'preview' | 'settings';

const draftOf = (song: Song | null): SongDraft => ({
  title: song?.title ?? '',
  author: song?.author ?? '',
  copyright: song?.copyright ?? '',
  ccli: song?.ccli ?? '',
  year: song?.year?.toString() ?? '',
  lyrics: song?.lyrics ?? '',
  background: song?.background ?? null,
});

/** The fields to save, tidied; a year that is not a whole number becomes NaN and is rejected. */
function fieldsOf(draft: SongDraft) {
  const year = draft.year.trim();
  return cleanSongFields({
    ...draft,
    year: year === '' ? null : /^-?\d+$/.test(year) ? Number(year) : NaN,
    deck: null,
  });
}

/**
 * Song editor with a tabbed preview of the generated slides. Used for the library and for
 * fixing lyrics during a presentation. Give it a `key` so it resets when the song changes.
 */
type SongFormProps = {
  song: Song | null;
  /** Hide the title and open on the lyrics, for quick fixes while live. */
  quick?: boolean;
  onSaved(song: Song): void;
  onDirtyChange?(dirty: boolean): void;
  actions?: ReactNode;
};

export function SongForm(props: SongFormProps) {
  return props.song?.deck ? (
    <DeckForm {...props} song={props.song} deck={props.song.deck} />
  ) : (
    <LyricsForm {...props} />
  );
}

/** An imported slide deck: its title can be changed, its slides only by importing again. */
function DeckForm(props: SongFormProps & { song: Song; deck: Deck }) {
  const session = useSession();
  const { song, deck, onDirtyChange } = props;
  const [title, setTitle] = useState(song.title);
  const [saving, setSaving] = useState(false);
  const dirty = title.trim() !== song.title;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const canSave = dirty && !saving && title.trim() !== '';

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = await session.saveSong(song.id, { title: title.trim() });
      setTitle(result.title);
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
    >
      {!props.quick && (
        <label>
          <span className="label">{t('songs.title')}</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      <p className="text-xs text-slate-400">
        {t('songs.deckSource', { source: deck.source })} ·{' '}
        {t('songs.pieceCount', { count: deck.pages.length })}
        <br />
        {t('songs.deckHint')}
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] content-start gap-2 overflow-auto rounded-md border border-slate-700 bg-slate-900/60 p-2">
        {deck.pages.map((page) => (
          <figure key={page.image} className="rounded-md bg-black">
            <SlideImage
              image={page.image}
              className="w-full rounded-md"
              style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
            />
            <figcaption className="px-1 py-0.5 text-[10px] text-slate-500">
              {page.step > 0 ? `${page.slide}.${page.step}` : page.slide}
            </figcaption>
          </figure>
        ))}
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

function LyricsForm(props: SongFormProps) {
  const session = useSession();
  const { song, onDirtyChange } = props;
  const [draft, setDraft] = useState(() => draftOf(song));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('lyrics');
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const copyrightRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const scrollKey = `${props.quick ? 'quick' : 'page'}:${song?.id ?? 'new'}`;
  useScrollMemory(lyricsRef, `songForm.lyrics:${scrollKey}`);
  useScrollMemory(copyrightRef, `songForm.copyright:${scrollKey}`);
  useScrollMemory(previewRef, `songForm.preview:${scrollKey}`);
  useScrollMemory(settingsRef, `songForm.settings:${scrollKey}`);
  const settings = useQuery(() => session.store.getPresentationSettings(session.workspace.id), []);
  const linesPerPiece = settings?.linesPerPiece ?? 2;

  const saved = draftOf(song);
  const dirty = (Object.keys(saved) as (keyof SongDraft)[]).some(
    (key) => JSON.stringify(saved[key]) !== JSON.stringify(draft[key]),
  );
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const pieces = useMemo(() => {
    let n = 0;
    const ids = assignLineIds(null, draft.lyrics, () => `preview-${n++}`);
    return buildPieces(draft.lyrics, ids, linesPerPiece);
  }, [draft.lyrics, linesPerPiece]);

  const invalid = invalidSongFields(fieldsOf(draft), new Date());
  const tabs: Tab[] = ['lyrics', 'copyright', 'preview', 'settings'];
  const canSave =
    dirty &&
    !saving &&
    invalid.length === 0 &&
    (draft.title.trim() !== '' || draft.lyrics.trim() !== '');
  const set = (patch: Partial<SongDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      // An untitled song takes its first lyric line as its title.
      const cleaned = fieldsOf(draft);
      const title = cleaned.title || pieces[0]?.lines[0]?.text.trim() || t('songs.untitled');
      const fields = { ...cleaned, title };
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
      {!props.quick && (
        <label>
          <span className="label">{t('songs.title')}</span>
          <input
            className="field"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            autoFocus={!song}
          />
        </label>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div role="tablist" className="mb-2 flex gap-1 border-b border-slate-700">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium tracking-wide uppercase ${
                tab === key ? 'border-sky-500' : 'border-transparent'
              } ${
                // Flag the copyright tab while one of its fields blocks saving.
                key === 'copyright' && invalid.length > 0
                  ? 'text-rose-300'
                  : tab === key
                    ? 'text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setTab(key)}
            >
              {key === 'lyrics'
                ? t('songs.lyrics')
                : key === 'copyright'
                  ? t('songs.copyrightTab')
                  : key === 'settings'
                    ? t('songs.settingsTab')
                    : `${t('songs.preview')} · ${t('songs.pieceCount', { count: pieces.length })}`}
            </button>
          ))}
        </div>
        {/* Both panes stay mounted so the cursor and scroll position survive a tab switch. */}
        <div
          role="tabpanel"
          className={`min-h-0 flex-1 flex-col ${tab === 'lyrics' ? 'flex' : 'hidden'}`}
        >
          <textarea
            ref={lyricsRef}
            className="field min-h-40 flex-1 resize-none leading-relaxed"
            aria-label={t('songs.lyrics')}
            value={draft.lyrics}
            onChange={(e) => set({ lyrics: e.target.value })}
            spellCheck={false}
            autoFocus={props.quick}
          />
          <span className="mt-1 text-xs text-slate-500">
            {t('songs.lyricsHint', { count: linesPerPiece })}
          </span>
        </div>
        <div
          ref={copyrightRef}
          role="tabpanel"
          className={`min-h-0 flex-1 content-start gap-3 overflow-auto ${
            tab === 'copyright' ? 'grid grid-cols-2' : 'hidden'
          }`}
        >
          <label className="col-span-2">
            <span className="label">{t('songs.author')}</span>
            <input
              className="field"
              value={draft.author}
              placeholder={t('songs.authorHint')}
              onChange={(e) => set({ author: e.target.value })}
            />
          </label>
          <label className="col-span-2">
            <span className="label">{t('songs.copyright')}</span>
            <input
              className="field"
              value={draft.copyright}
              onChange={(e) => set({ copyright: e.target.value })}
            />
          </label>
          <label>
            <span className="label">{t('songs.ccli')}</span>
            <input
              className="field"
              inputMode="numeric"
              value={draft.ccli}
              aria-invalid={invalid.includes('ccli')}
              onChange={(e) => set({ ccli: e.target.value })}
            />
            {invalid.includes('ccli') && (
              <span className="mt-1 block text-xs text-rose-300">{t('songs.ccliInvalid')}</span>
            )}
          </label>
          <label>
            <span className="label">{t('songs.year')}</span>
            <input
              className="field"
              inputMode="numeric"
              value={draft.year}
              aria-invalid={invalid.includes('year')}
              onChange={(e) => set({ year: e.target.value })}
            />
            {invalid.includes('year') && (
              <span className="mt-1 block text-xs text-rose-300">
                {t('songs.yearInvalid', { max: maxSongYear(new Date()) })}
              </span>
            )}
          </label>
        </div>
        <div
          ref={previewRef}
          role="tabpanel"
          className={`min-h-0 flex-1 space-y-2 overflow-auto rounded-md border border-slate-700 bg-slate-900/60 p-2 ${
            tab === 'preview' ? '' : 'hidden'
          }`}
        >
          {pieces.length === 0 && (
            <p className="p-2 text-sm text-slate-500">{t('songs.previewEmpty')}</p>
          )}
          {pieces.map((piece, index) => (
            <div
              key={piece.id}
              className={`rounded-md border-2 px-3 py-2 text-center text-sm ${
                // Alternate styles by block, as on the Present tab.
                piece.blockIndex % 2 === 0
                  ? 'border-slate-700 bg-slate-800'
                  : 'border-sky-700 bg-sky-900/60'
              } ${piece.indexInBlock === 0 && index > 0 ? 'mt-4' : ''}`}
            >
              {piece.lines.map((line) => (
                <div key={line.id} className="whitespace-pre-wrap">
                  {line.text}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          ref={settingsRef}
          role="tabpanel"
          className={`min-h-0 flex-1 space-y-3 overflow-auto ${tab === 'settings' ? '' : 'hidden'}`}
        >
          <SongBackgroundFields
            value={draft.background}
            onChange={(background) => set({ background })}
          />
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

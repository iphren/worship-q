import { assignLineIds, buildPieces } from '@worship-q/lyrics';
import {
  cleanSongFields,
  invalidSongFields,
  maxSongYear,
  websiteUrl,
  type Deck,
  type Song,
  type SongBackground,
} from '@worship-q/protocol';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useCloud, useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { SongBackgroundFields } from './BackgroundPicker';
import { ConfirmDialog } from './Dialog';
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
    website: null,
  });
}

/**
 * Song editor with a tabbed preview of the generated slides. Used for the library and for
 * fixing lyrics during a presentation. Give it a `key` so it resets when the song changes.
 */
type SongFormProps = {
  song: Song | null;
  /** Open on the lyrics, for quick fixes while live; decks and websites hide their title. */
  quick?: boolean;
  onSaved(song: Song): void;
  onDirtyChange?(dirty: boolean): void;
  actions?: ReactNode;
  /** With no song, adds a website instead of a song. */
  website?: boolean;
};

export function SongForm(props: SongFormProps) {
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = (value: boolean) => {
    setDirty(value);
    props.onDirtyChange?.(value);
  };
  const inner = { ...props, onDirtyChange };
  const form =
    props.song?.website || (!props.song && props.website) ? (
      <WebsiteForm {...inner} />
    ) : props.song?.deck ? (
      <DeckForm {...inner} song={props.song} deck={props.song.deck} />
    ) : (
      <LyricsForm {...inner} />
    );
  if (!props.song?.versions || props.quick) return form;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <VersionsBar song={props.song} dirty={dirty} onChanged={props.onSaved} />
      <div className="min-h-0 flex-1">{form}</div>
    </div>
  );
}

const changedText = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * A song with two versions (D32): which one this workspace presents, with the other one a
 * click away to read, and the way to drop the workspace's own.
 */
function VersionsBar(props: { song: Song; dirty: boolean; onChanged(song: Song): void }) {
  const session = useSession();
  const { cloud } = useApp();
  const status = useCloud();
  const { song } = props;
  const versions = song.versions!;
  const [showOther, setShowOther] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;
  const other = useQuery(
    () =>
      song.useChurchVersion
        ? session.store.getOwnVersion(song.id)
        : session.store.getChurchVersion(song.id),
    [song.id, song.useChurchVersion, song.revision],
  );

  async function choose(useChurch: boolean) {
    if (props.dirty || useChurch === song.useChurchVersion) return;
    props.onChanged(await session.setUseChurchVersion(song.id, useChurch));
  }

  async function deleteOwn() {
    setDeleting(false);
    setError(null);
    try {
      await cloud.deleteOwnVersion(song.id);
      const after = await session.store.getSong(song.id);
      if (after) props.onChanged(after);
    } catch (e) {
      setError(t('songs.deleteOwnVersionFailed', { error: String(e) }));
    }
  }

  const option = (useChurch: boolean, label: string, stamp: { updatedAt: string }) => {
    const selected = song.useChurchVersion === useChurch;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        className={`rounded-md border px-3 py-1.5 text-left text-sm ${
          selected
            ? 'border-sky-500 bg-sky-900/60 text-slate-100'
            : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
        } disabled:cursor-not-allowed disabled:opacity-60`}
        disabled={props.dirty && !selected}
        title={props.dirty && !selected ? t('songs.versionsSaveFirst') : undefined}
        onClick={() => void choose(useChurch)}
      >
        <span className="font-medium">{label}</span>
        <span className="ml-2 text-xs text-slate-400">
          {t('songs.versionChanged', { time: changedText(stamp.updatedAt) })}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup">
        {option(true, t('songs.versionChurch'), versions.church)}
        {option(false, t('songs.versionOwn'), versions.own)}
        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowOther((v) => !v)}
        >
          {showOther ? t('songs.hideOtherVersion') : t('songs.showOtherVersion')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-rose-300"
          disabled={!connected}
          title={connected ? undefined : t('songs.deleteOwnVersionNeedsServer')}
          onClick={() => setDeleting(true)}
        >
          {t('songs.deleteOwnVersion')}
        </button>
      </div>
      <p className="text-xs text-slate-400">{t('songs.versionsHint')}</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {showOther && other && (
        <div className="max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900/60 p-2 text-sm">
          <p className="mb-1 font-semibold text-slate-200">
            {other.title || t('songs.untitled')}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {song.useChurchVersion ? t('songs.versionOwn') : t('songs.versionChurch')}
            </span>
          </p>
          <pre className="font-sans whitespace-pre-wrap text-slate-300">{other.lyrics}</pre>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('songs.deleteOwnVersionTitle', { title: song.title || t('songs.untitled') })}
          body={t('songs.deleteOwnVersionBody')}
          confirmLabel={t('songs.deleteOwnVersionConfirm')}
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={() => void deleteOwn()}
        />
      )}
    </div>
  );
}

/** A web page shown live on the slideshow: a title and its address. */
function WebsiteForm(props: SongFormProps) {
  const session = useSession();
  const { song, onDirtyChange } = props;
  const [title, setTitle] = useState(song?.title ?? '');
  const [address, setAddress] = useState(song?.website?.url ?? '');
  const [saving, setSaving] = useState(false);
  const url = websiteUrl(address);
  const dirty =
    title.trim() !== (song?.title ?? '') || address.trim() !== (song?.website?.url ?? '');
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const canSave = dirty && !saving && url !== null;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      // An untitled website is named after its site.
      const fields = { title: title.trim() || new URL(url).hostname, website: { url } };
      const result = song
        ? await session.saveSong(song.id, fields)
        : await session.createSong(fields);
      setTitle(result.title);
      setAddress(result.website?.url ?? '');
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
          <input
            className="field"
            value={title}
            placeholder={url ? new URL(url).hostname : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      )}
      <label>
        <span className="label">{t('songs.websiteUrl')}</span>
        <input
          className="field"
          type="url"
          inputMode="url"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://"
          value={address}
          aria-invalid={address.trim() !== '' && url === null}
          onChange={(e) => setAddress(e.target.value)}
          autoFocus={!song}
        />
        {address.trim() !== '' && url === null && (
          <span className="mt-1 block text-xs text-rose-300">{t('songs.websiteInvalid')}</span>
        )}
      </label>
      <p className="text-xs text-slate-400">{t('songs.websiteHint')}</p>
      <div className="mt-auto flex items-center justify-end gap-2">
        {props.actions}
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

/** Just the title of a deck or website, for renaming while live. */
export function TitleForm(props: { song: Song; onSaved(song: Song): void; actions?: ReactNode }) {
  const session = useSession();
  const { song } = props;
  const [title, setTitle] = useState(song.title);
  const [saving, setSaving] = useState(false);
  const canSave = title.trim() !== song.title && title.trim() !== '' && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      props.onSaved(await session.saveSong(song.id, { title: title.trim() }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        <span className="label">{t('songs.title')}</span>
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {props.actions}
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {t('common.save')}
        </button>
      </div>
    </form>
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
      <label>
        <span className="label">{t('songs.title')}</span>
        <input
          className="field"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!song}
        />
      </label>
      {dirty && song?.origin === 'church' && !session.store.managesChurchLibrary && (
        <p className="text-xs text-sky-200">{t('songs.churchEditHint')}</p>
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

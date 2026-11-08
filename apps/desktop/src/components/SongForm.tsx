import { assignLineIds, buildPieces } from '@worship-q/lyrics';
import {
  cleanSongFields,
  invalidSongFields,
  maxSongYear,
  websiteUrl,
  type Deck,
  type Song,
  type SongBackground,
  type Video,
} from '@worship-q/protocol';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, useCloud, useQuery, useSession } from '../app/context';
import { t } from '../i18n';
import { SongBackgroundFields } from './BackgroundPicker';
import { ConfirmDialog } from './Dialog';
import { SlideImage } from './SlideImage';
import { MediaActions } from './MediaActions';
import { songMediaKind } from '../app/media';
import { native } from '../platform/native';
import { formatDuration } from '@worship-q/session';
import { useScrollMemory } from '../lib/scrollMemory';

export interface SongDraft {
  title: string;
  author: string;
  copyright: string;
  ccli: string;
  year: string;
  lyrics: string;
}

type Tab = 'lyrics' | 'copyright' | 'preview' | 'settings';

const draftOf = (song: Song | null): SongDraft => ({
  title: song?.title ?? '',
  author: song?.author ?? '',
  copyright: song?.copyright ?? '',
  ccli: song?.ccli ?? '',
  year: song?.year?.toString() ?? '',
  lyrics: song?.lyrics ?? '',
});

/**
 * The fields to save, tidied; a year that is not a whole number becomes NaN and is rejected.
 * The background is not among them: it is the workspace's setting, not part of the song.
 */
function fieldsOf(draft: SongDraft) {
  const year = draft.year.trim();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { background, ...fields } = cleanSongFields({
    ...draft,
    year: year === '' ? null : /^-?\d+$/.test(year) ? Number(year) : NaN,
    background: null,
    deck: null,
    website: null,
    video: null,
  });
  return fields;
}

const sameBackground = (a: SongBackground | null, b: SongBackground | null) =>
  a?.color === b?.color && a?.assetId === b?.assetId;

/** A song's background being chosen in the editor, saved as the workspace's setting. */
type BackgroundDraft = {
  value: SongBackground | null;
  /** Differs from the saved choice. */
  changed: boolean;
  /** The saved choice is known, so a change can be told apart. */
  ready: boolean;
  set(value: SongBackground | null): void;
};

function useBackgroundDraft(song: Song | null): BackgroundDraft {
  const session = useSession();
  const saved = useQuery(
    async () => (song ? session.store.getSongBackground(song) : null),
    [song?.id],
  );
  const [draft, setDraft] = useState<SongBackground | null | undefined>(undefined);
  const value = draft === undefined ? (saved ?? null) : draft;
  return {
    value,
    changed: draft !== undefined && saved !== undefined && !sameBackground(draft, saved),
    ready: saved !== undefined,
    set: setDraft,
  };
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
  /** On a song with two versions: the one this form shows, and the choice still to save. */
  version?: VersionProps;
  /** The background being chosen, when shared by both versions of a song. */
  background?: BackgroundDraft;
};

type VersionProps = {
  /** The church's version: shown, never edited here. */
  readOnly: boolean;
  /** This version is chosen but not yet the one in use; saving makes it so. */
  switched: boolean;
  /** Makes this version the one in use. */
  commit(): Promise<Song>;
};

function InnerForm(props: SongFormProps) {
  return props.song?.website || (!props.song && props.website) ? (
    <WebsiteForm {...props} />
  ) : props.song?.video ? (
    <VideoForm {...props} song={props.song} video={props.song.video} />
  ) : props.song?.deck ? (
    <DeckForm {...props} song={props.song} deck={props.song.deck} />
  ) : (
    <LyricsForm {...props} />
  );
}

export function SongForm(props: SongFormProps) {
  if (!props.song?.versions || props.quick) return <InnerForm {...props} />;
  return <VersionedSongForm {...props} song={props.song} />;
}

/**
 * A song with two versions (D32): a switch between them, the church's shown read-only and
 * the workspace's editable. The choice, like any edit, takes effect only on Save.
 */
function VersionedSongForm(props: SongFormProps & { song: Song }) {
  const session = useSession();
  const { song, onDirtyChange } = props;
  const [useChurch, setUseChurch] = useState(song.useChurchVersion);
  const [dirty, setDirty] = useState({ own: false, church: false });
  const own = useQuery(() => session.store.getOwnVersion(song.id), [song.id]);
  const church = useQuery(() => session.store.getChurchVersion(song.id), [song.id]);
  const active = useChurch ? dirty.church : dirty.own;
  useEffect(() => onDirtyChange?.(active), [active, onDirtyChange]);
  const ownDirty = useCallback((own: boolean) => setDirty((d) => ({ ...d, own })), []);
  const churchDirty = useCallback((church: boolean) => setDirty((d) => ({ ...d, church })), []);
  // One background for the song, whichever version is shown.
  const background = useBackgroundDraft(song);

  const saved = (result: Song) => {
    setUseChurch(result.useChurchVersion);
    props.onSaved(result);
  };
  const versionOf = (church: boolean): VersionProps => ({
    readOnly: church,
    switched: song.useChurchVersion !== church,
    commit: () => session.setUseChurchVersion(song.id, church),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <VersionsBar
        song={song}
        useChurch={useChurch}
        onChoose={setUseChurch}
        onDeleted={props.onSaved}
      />
      {own && church && (
        <>
          <div className={`min-h-0 flex-1 ${useChurch ? 'hidden' : ''}`}>
            <InnerForm
              key="own"
              {...props}
              song={own}
              version={versionOf(false)}
              background={background}
              onSaved={saved}
              onDirtyChange={ownDirty}
            />
          </div>
          <div className={`min-h-0 flex-1 ${useChurch ? '' : 'hidden'}`}>
            <InnerForm
              // Read-only, so it can follow a newer church's version without losing anything.
              key={`church-${church.revision}`}
              {...props}
              song={church}
              version={versionOf(true)}
              background={background}
              onSaved={saved}
              onDirtyChange={churchDirty}
            />
          </div>
        </>
      )}
    </div>
  );
}

const changedText = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The switch between a song's two versions, and the way to drop the workspace's own. */
function VersionsBar(props: {
  song: Song;
  useChurch: boolean;
  onChoose(useChurch: boolean): void;
  onDeleted(song: Song): void;
}) {
  const session = useSession();
  const { cloud } = useApp();
  const status = useCloud();
  const { song, useChurch } = props;
  const versions = song.versions!;
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;

  async function deleteOwn() {
    setDeleting(false);
    setError(null);
    try {
      await cloud.deleteOwnVersion(song.id);
      const after = await session.store.getSong(song.id);
      if (after) props.onDeleted(after);
    } catch (e) {
      setError(t('songs.deleteOwnVersionFailed', { error: String(e) }));
    }
  }

  const option = (church: boolean, label: string, stamp: { updatedAt: string }) => {
    const selected = useChurch === church;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        title={t('songs.versionChanged', { time: changedText(stamp.updatedAt) })}
        className={`px-3 py-1 text-sm font-medium ${
          selected ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'
        }`}
        onClick={() => props.onChoose(church)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          className="inline-flex overflow-hidden rounded-md border border-slate-600 bg-slate-800"
        >
          {option(true, t('songs.versionChurch'), versions.church)}
          {option(false, t('songs.versionOwn'), versions.own)}
        </div>
        {/* One place beside the switch: the original version cannot be changed here, and
            ours can be deleted. */}
        {useChurch ? (
          <button type="button" className="btn btn-sm" disabled>
            {t('songs.readOnly')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm text-rose-300"
            disabled={!connected}
            title={connected ? undefined : t('songs.deleteOwnVersionNeedsServer')}
            onClick={() => setDeleting(true)}
          >
            {t('songs.deleteOwnVersion')}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
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
  const readOnly = !!props.version?.readOnly;
  const switched = !!props.version?.switched;
  const changed =
    title.trim() !== (song?.title ?? '') || address.trim() !== (song?.website?.url ?? '');
  const dirty = changed || switched;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const canSave = !saving && ((changed && url !== null) || switched);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      let result: Song;
      if (changed && url !== null) {
        // An untitled website is named after its site.
        const fields = { title: title.trim() || new URL(url).hostname, website: { url } };
        result = song ? await session.saveSong(song.id, fields) : await session.createSong(fields);
      } else {
        result = await props.version!.commit();
      }
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
            readOnly={readOnly}
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
          readOnly={readOnly}
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
  const readOnly = !!props.version?.readOnly;
  const switched = !!props.version?.switched;
  const changed = title.trim() !== song.title;
  const dirty = changed || switched;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const canSave = !saving && ((changed && title.trim() !== '') || switched);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const result =
        changed && title.trim() !== ''
          ? await session.saveSong(song.id, { title: title.trim() })
          : await props.version!.commit();
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
          <input
            className="field"
            value={title}
            readOnly={readOnly}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      )}
      <p className="text-xs text-slate-400">
        {t(`media.kind.${songMediaKind(song) ?? 'slides'}`)} ·{' '}
        {t('songs.deckSource', { source: deck.source })} ·{' '}
        {deck.kind === 'image'
          ? t('media.pixels', { width: deck.width, height: deck.height })
          : t('songs.pieceCount', { count: deck.pages.length })}
        <br />
        {t(deck.kind === 'image' ? 'media.imageHint' : 'songs.deckHint')}
      </p>
      {!props.quick && !readOnly && (
        <MediaActions song={song} dirty={dirty} onSaved={props.onSaved} />
      )}
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

/** Bytes in MB with one decimal. */
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * An uploaded video (U14, U23): its title and Autoplay can be changed; its file only by
 * uploading a new version. The preview is muted and has its own controls.
 */
export function VideoForm(props: SongFormProps & { song: Song; video: Video }) {
  const session = useSession();
  const { song, video, onDirtyChange } = props;
  const [title, setTitle] = useState(song.title);
  const [autoplay, setAutoplay] = useState(video.autoplay);
  const [saving, setSaving] = useState(false);
  const readOnly = !!props.version?.readOnly;
  const switched = !!props.version?.switched;
  const changed = title.trim() !== song.title || autoplay !== video.autoplay;
  const dirty = changed || switched;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const canSave = !saving && ((changed && title.trim() !== '') || switched);
  const url = useQuery(() => native.videoUrl(video.file).catch(() => null), [video.file]);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = changed
        ? await session.saveSong(song.id, {
            title: title.trim(),
            // Autoplay is part of the video's record (U23).
            video: { ...video, autoplay },
          })
        : await props.version!.commit();
      setTitle(result.title);
      setAutoplay(result.video?.autoplay ?? false);
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
      <label>
        <span className="label">{t('songs.title')}</span>
        <input
          className="field"
          value={title}
          readOnly={readOnly}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={autoplay}
          disabled={readOnly}
          onChange={(e) => setAutoplay(e.target.checked)}
        />
        <span>
          <span className="block text-sm">{t('media.autoplay')}</span>
          <span className="block text-xs text-slate-400">{t('media.autoplayHint')}</span>
        </span>
      </label>
      <p className="text-xs text-slate-400">
        {t('media.kind.video')} · {t('songs.deckSource', { source: video.source })} ·{' '}
        {formatDuration(video.durationSeconds)} ·{' '}
        {t('media.pixels', { width: video.width, height: video.height })} ·{' '}
        {t('media.size', { size: megabytes(video.bytes) })}
      </p>
      {!props.quick && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-slate-700 bg-black">
          {url ? (
            <video
              key={url}
              src={url}
              className="h-full max-h-full w-full object-contain"
              muted
              controls
              preload="metadata"
            />
          ) : (
            <p className="p-4 text-sm text-slate-400">
              {url === null ? t('media.notDownloaded') : ''}
            </p>
          )}
        </div>
      )}
      {!props.quick && !readOnly && (
        <MediaActions song={song} dirty={dirty} onSaved={props.onSaved} />
      )}
      <div className="mt-auto flex items-center justify-end gap-2">
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
  const readOnly = !!props.version?.readOnly;
  const switched = !!props.version?.switched;
  // The two versions of a song keep their own scroll positions.
  const variant = props.version ? (readOnly ? ':church' : ':own') : '';
  const scrollKey = `${props.quick ? 'quick' : 'page'}:${song?.id ?? 'new'}${variant}`;
  useScrollMemory(lyricsRef, `songForm.lyrics:${scrollKey}`);
  useScrollMemory(copyrightRef, `songForm.copyright:${scrollKey}`);
  useScrollMemory(previewRef, `songForm.preview:${scrollKey}`);
  useScrollMemory(settingsRef, `songForm.settings:${scrollKey}`);
  const settings = useQuery(() => session.store.getPresentationSettings(session.workspace.id), []);
  const linesPerPiece = settings?.linesPerPiece ?? 2;
  const ownBackground = useBackgroundDraft(song);
  const background = props.background ?? ownBackground;

  const saved = draftOf(song);
  const changed = (Object.keys(saved) as (keyof SongDraft)[]).some(
    (key) => JSON.stringify(saved[key]) !== JSON.stringify(draft[key]),
  );
  const dirty = changed || background.changed || switched;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const pieces = useMemo(() => {
    let n = 0;
    const ids = assignLineIds(null, draft.lyrics, () => `preview-${n++}`);
    return buildPieces(draft.lyrics, ids, linesPerPiece);
  }, [draft.lyrics, linesPerPiece]);

  const invalid = invalidSongFields(fieldsOf(draft), new Date());
  const tabs: Tab[] = ['lyrics', 'copyright', 'preview', 'settings'];
  const fieldsSavable =
    changed &&
    !readOnly &&
    invalid.length === 0 &&
    (draft.title.trim() !== '' || draft.lyrics.trim() !== '');
  // A new song needs its words first; the background is saved with it.
  const canSave =
    !saving &&
    background.ready &&
    (song ? fieldsSavable || background.changed || switched : fieldsSavable);
  const set = (patch: Partial<SongDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      let result = song;
      if (fieldsSavable) {
        // An untitled song takes its first lyric line as its title.
        const cleaned = fieldsOf(draft);
        const title = cleaned.title || pieces[0]?.lines[0]?.text.trim() || t('songs.untitled');
        const fields = { ...cleaned, title };
        result = song ? await session.saveSong(song.id, fields) : await session.createSong(fields);
        setDraft(draftOf(result));
      }
      if (!result) return;
      if (background.changed) await session.setSongBackground(result.id, background.value);
      if (switched) result = await props.version!.commit();
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
          readOnly={readOnly}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!song}
        />
      </label>
      {changed && song?.origin === 'church' && !session.store.managesChurch('song', song) && (
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
            readOnly={readOnly}
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
              readOnly={readOnly}
              placeholder={t('songs.authorHint')}
              onChange={(e) => set({ author: e.target.value })}
            />
          </label>
          <label className="col-span-2">
            <span className="label">{t('songs.copyright')}</span>
            <input
              className="field"
              value={draft.copyright}
              readOnly={readOnly}
              onChange={(e) => set({ copyright: e.target.value })}
            />
          </label>
          <label>
            <span className="label">{t('songs.ccli')}</span>
            <input
              className="field"
              inputMode="numeric"
              value={draft.ccli}
              readOnly={readOnly}
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
              readOnly={readOnly}
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
          {/* The workspace's choice, not part of the song: open on either version. */}
          <SongBackgroundFields value={background.value} onChange={background.set} />
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

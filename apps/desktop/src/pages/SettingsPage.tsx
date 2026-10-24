import { getVersion } from '@tauri-apps/api/app';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  MAX_LINES_PER_PIECE,
  MAX_SCALE,
  MIN_LINES_PER_PIECE,
  MIN_SCALE,
  type BackgroundAsset,
  type OutputFrame,
  type Song,
  type SongBackground,
} from '@worship-q/protocol';
import { SCHEMA_VERSION } from '@worship-q/store';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import { BackgroundPicker, SongBackgroundFields } from '../components/BackgroundPicker';
import { ChurchConnection } from '../components/ChurchConnection';
import { ConfirmDialog } from '../components/Dialog';
import { OutputPanel, useOutputStatus } from '../components/OutputPanel';
import { SlidePreview, SubtitlePreview } from '../components/SlidePreview';
import { meetingDaysLabel, t, weekdayName } from '../i18n';
import { useScrollMemory } from '../lib/scrollMemory';
import { native } from '../platform/native';

const BACKGROUND_EXTENSIONS = ['jpg', 'jpeg', 'png', 'mp4'];
const BACKUP_EXTENSION = 'worshipq';

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">{props.title}</h2>
        {props.hint && <p className="mt-0.5 text-xs text-slate-400">{props.hint}</p>}
      </div>
      {props.children}
    </section>
  );
}

function errorText(error: unknown): string {
  const code = String(error);
  if (code.includes('not-a-backup')) return t('settings.restoreNotBackup');
  if (code.includes('backup-too-new')) return t('settings.restoreTooNew');
  return t('settings.failed', { error: code });
}

/**
 * The background of the song on screen. Changes are saved after a short pause, so dragging
 * the color picker does not save a revision of the song for every step.
 */
function OnScreenSongBackground(props: { song: Song }) {
  const session = useSession();
  const { song } = props;
  const [value, setValue] = useState(song.background);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);
  // Save what is still waiting when the page is left.
  useEffect(() => () => pending.current?.(), []);

  function change(background: SongBackground | null) {
    setValue(background);
    window.clearTimeout(timer.current);
    pending.current = () => {
      window.clearTimeout(timer.current);
      pending.current = null;
      void session.saveSong(song.id, { background });
    };
    timer.current = window.setTimeout(() => pending.current?.(), 400);
  }

  return <SongBackgroundFields value={value} onChange={change} />;
}

export function SettingsPage() {
  const { output } = useApp();
  const session = useSession();
  const status = useOutputStatus();
  const workspaceId = session.workspace.id;
  const mainRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useScrollMemory(mainRef, 'settings.main');
  useScrollMemory(asideRef, 'settings.preview');
  const settings = useQuery(() => session.store.getPresentationSettings(workspaceId), []);
  const own = useQuery(() => session.store.getWorkspaceSettings(workspaceId), []);
  const church = useQuery(() => session.store.getChurchSettings(), []);
  const profile = useQuery(() => session.store.getOutputProfile(workspaceId), []);
  const subtitleProfile = useQuery(
    () => session.store.getOutputProfile(workspaceId, 'subtitle'),
    [],
  );
  const [overlay, setOverlay] = useState<{ url: string; error: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const onScreenId = session.isLive ? (session.live?.presented?.songId ?? null) : null;
  const onScreen = useQuery(
    async () => (onScreenId ? session.store.getSong(onScreenId) : null),
    [onScreenId],
  );
  const [fonts, setFonts] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [missing, setMissing] = useState('');
  const [restoreFrom, setRestoreFrom] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void native.listFontFamilies().then(setFonts);
    void getVersion().then(setVersion);
    void native.overlayStatus().then(([url, error]) => setOverlay({ url, error }));
  }, []);

  // Warn when the font in use lacks characters the songs use.
  const fontFamily = profile?.fontFamily ?? church?.slideshowFontFamily ?? null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fontFamily) return '';
      const songs = await session.store.listSongs(workspaceId);
      return native.fontMissingChars(fontFamily, songs.map((song) => song.lyrics).join('\n'));
    })().then((chars) => !cancelled && setMissing(chars));
    return () => {
      cancelled = true;
    };
  }, [fontFamily, session, workspaceId]);

  if (!settings || !profile || !own || !church || !subtitleProfile) return null;

  /** Says where a setting comes from, and offers to go back to the church default. */
  function inheritance(key: 'linesPerPiece' | 'wrapLongLines') {
    const churchValue = church![key];
    if (churchValue === undefined) return null;
    const shown =
      typeof churchValue === 'boolean'
        ? t(churchValue ? 'settings.yes' : 'settings.no')
        : String(churchValue);
    if (own![key] === undefined) {
      return <p className="text-xs text-slate-400">{t('settings.inheritedHint')}</p>;
    }
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        {t('settings.overriddenHint', { value: shown })}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void session.updatePresentationSettings({ [key]: null })}
        >
          {t('settings.useChurchDefault')}
        </button>
      </p>
    );
  }

  function fontOptions(current: string | null, churchFont: string | null | undefined) {
    return (
      <>
        <option value="">
          {churchFont
            ? t('settings.churchDefaultValue', { value: churchFont })
            : t('settings.fontDefault')}
        </option>
        {current && !fonts.includes(current) && <option value={current}>{current}</option>}
        {fonts.map((family) => (
          <option key={family} value={family}>
            {family}
          </option>
        ))}
      </>
    );
  }

  const days = session.workspace.meetingDays;
  const toggleDay = (day: number) =>
    void session.setMeetingDays(
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    );

  async function importBackground() {
    const source = await open({
      multiple: false,
      filters: [{ name: t('settings.backgroundTypes'), extensions: BACKGROUND_EXTENSIONS }],
    });
    if (typeof source !== 'string') return;
    try {
      const originalName = source.split(/[\\/]/).pop() ?? source;
      const extension = (originalName.split('.').pop() ?? '').toLowerCase();
      const id = session.store.newId();
      const fileName = `${id}.${extension}`;
      await native.importBackground(source, fileName);
      await session.addBackground({
        id,
        kind: extension === 'mp4' ? 'video' : 'image',
        fileName,
        originalName,
      });
      await session.updateOutputProfile({ backgroundAssetId: id });
      setMessage(null);
    } catch (error) {
      setMessage({ text: errorText(error), error: true });
    }
  }

  async function removeBackground(asset: BackgroundAsset) {
    await session.removeBackground(asset.id);
    await native.removeBackgroundFile(asset.fileName).catch(() => undefined);
    output.forgetFiles();
  }

  async function exportBackup() {
    const destination = await save({
      defaultPath: `worship-q-${session.today()}.${BACKUP_EXTENSION}`,
      filters: [{ name: 'Worship Q', extensions: [BACKUP_EXTENSION] }],
    });
    if (!destination) return;
    try {
      await native.exportBackup(destination);
      setMessage({ text: t('settings.exported'), error: false });
    } catch (error) {
      setMessage({ text: errorText(error), error: true });
    }
  }

  async function chooseRestore() {
    const source = await open({
      multiple: false,
      filters: [{ name: 'Worship Q', extensions: [BACKUP_EXTENSION] }],
    });
    if (typeof source === 'string') setRestoreFrom(source);
  }

  async function restore(source: string) {
    setRestoreFrom(null);
    try {
      await native.restoreBackup(source, SCHEMA_VERSION);
      // Start again from the restored data, exactly as after reopening the app.
      window.location.reload();
    } catch (error) {
      setMessage({ text: errorText(error), error: true });
    }
  }

  // Show sample lyrics when nothing is being presented, so settings can be judged. A slide
  // counts as presented: the previews then show it, and an empty subtitle overlay.
  const presenting = status.frame.song !== null || status.frame.pieceId !== null;
  const sample: OutputFrame = presenting
    ? status.frame
    : {
        ...status.frame,
        blank: false,
        song: {
          id: 'sample',
          pieces: [{ id: 'sample', lines: [t('settings.sampleLine1'), t('settings.sampleLine2')] }],
        },
        pieceId: 'sample',
      };
  const missingCount = Array.from(missing).length;

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <div ref={mainRef} className="min-w-0 flex-1 space-y-4 overflow-auto pr-1">
        <Section
          title={t('settings.meetingDays')}
          hint={t('settings.meetingDaysHint', { label: meetingDaysLabel(days) })}
        >
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <label
                key={day}
                className={`btn cursor-pointer ${days.includes(day) ? 'btn-primary' : ''}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={days.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {weekdayName(day, 'short')}
              </label>
            ))}
          </div>
        </Section>

        <Section title={t('settings.lyrics')}>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.linesPerPiece')}</span>
            <select
              className="field w-24"
              value={settings.linesPerPiece}
              onChange={(e) =>
                void session.updatePresentationSettings({ linesPerPiece: Number(e.target.value) })
              }
            >
              {Array.from(
                { length: MAX_LINES_PER_PIECE - MIN_LINES_PER_PIECE + 1 },
                (_, i) => i + MIN_LINES_PER_PIECE,
              ).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          {inheritance('linesPerPiece')}
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={settings.wrapLongLines}
              onChange={(e) =>
                void session.updatePresentationSettings({ wrapLongLines: e.target.checked })
              }
            />
            <span>
              {t('settings.wrap')}
              <span className="block text-xs text-slate-400">{t('settings.wrapHint')}</span>
            </span>
          </label>
          {inheritance('wrapLongLines')}
        </Section>

        <Section title={t('settings.slideshow')}>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.font')}</span>
            <select
              className="field max-w-sm"
              value={profile.fontFamily ?? ''}
              onChange={(e) =>
                void session.updateOutputProfile({ fontFamily: e.target.value || null })
              }
            >
              {fontOptions(profile.fontFamily, church.slideshowFontFamily)}
            </select>
          </label>
          {missingCount > 0 && (
            <p className="notice border-amber-500 bg-amber-900/30 text-amber-100">
              {t('settings.fontMissing', { count: missingCount })}
            </p>
          )}
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.scale')}</span>
            <input
              type="range"
              className="max-w-sm flex-1"
              min={MIN_SCALE * 100}
              max={MAX_SCALE * 100}
              step={5}
              value={Math.round(profile.scale * 100)}
              onChange={(e) =>
                void session.updateOutputProfile({ scale: Number(e.target.value) / 100 })
              }
            />
            <span className="w-12 text-right tabular-nums">{Math.round(profile.scale * 100)}%</span>
          </label>
          <p className="text-xs text-slate-400">{t('settings.scaleHint')}</p>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={profile.hideCursor}
              onChange={(e) => void session.updateOutputProfile({ hideCursor: e.target.checked })}
            />
            <span>
              {t('settings.hideCursor')}
              <span className="block text-xs text-slate-400">{t('settings.hideCursorHint')}</span>
            </span>
          </label>
        </Section>

        <Section
          title={t('settings.background')}
          hint={onScreen?.background ? t('settings.backgroundCovered') : undefined}
        >
          <BackgroundPicker
            color={profile.backgroundColor}
            assetId={profile.backgroundAssetId}
            onColor={(backgroundColor) => void session.updateOutputProfile({ backgroundColor })}
            onAsset={(backgroundAssetId) => void session.updateOutputProfile({ backgroundAssetId })}
            onRemove={(asset) => void removeBackground(asset)}
          />
          <button className="btn" onClick={() => void importBackground()}>
            {t('settings.backgroundImport')}
          </button>
        </Section>

        {onScreen && (
          <Section
            title={t('settings.songBackground', { title: onScreen.title || t('songs.untitled') })}
            hint={t('settings.songBackgroundHint')}
          >
            <OnScreenSongBackground key={onScreen.id} song={onScreen} />
          </Section>
        )}

        <Section title={t('subtitle.title')} hint={t('subtitle.hint')}>
          {overlay?.error ? (
            <p className="notice border-amber-500 bg-amber-900/30 text-amber-100">
              {t('subtitle.unavailable', { error: overlay.error })}
            </p>
          ) : (
            overlay && (
              <div className="space-y-1 text-sm">
                <p className="text-slate-300">{t('subtitle.url')}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 truncate rounded bg-slate-900 px-2 py-1 text-xs select-all">
                    {overlay.url}
                  </code>
                  <button
                    className="btn btn-sm shrink-0 whitespace-nowrap"
                    onClick={() => {
                      void navigator.clipboard.writeText(overlay.url).then(() => setCopied(true));
                      window.setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? t('subtitle.copied') : t('subtitle.copy')}
                  </button>
                </div>
              </div>
            )
          )}
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.font')}</span>
            <select
              className="field max-w-sm"
              value={subtitleProfile.fontFamily ?? ''}
              onChange={(e) =>
                void session.updateOutputProfile({ fontFamily: e.target.value || null }, 'subtitle')
              }
            >
              {fontOptions(subtitleProfile.fontFamily, church.subtitleFontFamily)}
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.scale')}</span>
            <input
              type="range"
              className="max-w-sm flex-1"
              min={MIN_SCALE * 100}
              max={MAX_SCALE * 100}
              step={5}
              value={Math.round(subtitleProfile.scale * 100)}
              onChange={(e) =>
                void session.updateOutputProfile(
                  { scale: Number(e.target.value) / 100 },
                  'subtitle',
                )
              }
            />
            <span className="w-12 text-right tabular-nums">
              {Math.round(subtitleProfile.scale * 100)}%
            </span>
          </label>
        </Section>

        <Section title={t('church.title')} hint={t('church.hint')}>
          <ChurchConnection />
        </Section>

        <Section title={t('settings.backup')} hint={t('settings.backupHint')}>
          <div className="flex gap-2">
            <button className="btn" onClick={() => void exportBackup()}>
              {t('settings.export')}
            </button>
            <button className="btn" onClick={() => void chooseRestore()}>
              {t('settings.restore')}
            </button>
          </div>
          {message && (
            <p
              className={`notice ${
                message.error
                  ? 'border-rose-600 bg-rose-900/30 text-rose-100'
                  : 'border-emerald-700 bg-emerald-900/30 text-emerald-200'
              }`}
            >
              {message.text}
            </p>
          )}
        </Section>

        <Section title={t('settings.about')}>
          <p className="text-sm text-slate-300">
            {t('app.name')} · {t('settings.version', { version })}
          </p>
          <p className="text-xs text-slate-400">
            {t('settings.timezone', { timezone: session.workspace.timezone })}
          </p>
        </Section>
      </div>

      <aside ref={asideRef} className="w-64 shrink-0 space-y-4 overflow-auto">
        <section className="panel space-y-2 p-3">
          <h2 className="label">{t('present.preview')}</h2>
          <SlidePreview frame={sample} />
        </section>
        <section className="panel space-y-2 p-3">
          <h2 className="label">{t('subtitle.preview')}</h2>
          <SubtitlePreview
            frame={
              presenting
                ? status.subtitle
                : {
                    ...status.subtitle,
                    blank: false,
                    song: sample.song,
                    pieceId: sample.pieceId,
                  }
            }
          />
        </section>
        <section className="panel p-3">
          <h2 className="label">{t('output.title')}</h2>
          <OutputPanel />
        </section>
      </aside>

      {restoreFrom && (
        <ConfirmDialog
          title={t('settings.restoreTitle')}
          body={t('settings.restoreBody')}
          confirmLabel={t('settings.restoreConfirm')}
          danger
          onCancel={() => setRestoreFrom(null)}
          onConfirm={() => void restore(restoreFrom)}
        />
      )}
    </div>
  );
}

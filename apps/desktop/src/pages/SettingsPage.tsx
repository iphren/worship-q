import { getVersion } from '@tauri-apps/api/app';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  MAX_LINES_PER_PIECE,
  MAX_SCALE,
  MIN_LINES_PER_PIECE,
  MIN_SCALE,
  type BackgroundAsset,
  type OutputFrame,
} from '@worship-q/protocol';
import { SCHEMA_VERSION } from '@worship-q/store';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import { ConfirmDialog } from '../components/Dialog';
import { OutputPanel, useOutputStatus } from '../components/OutputPanel';
import { SlidePreview } from '../components/SlidePreview';
import { meetingDaysLabel, t, weekdayName } from '../i18n';
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

export function SettingsPage() {
  const { output } = useApp();
  const session = useSession();
  const status = useOutputStatus();
  const workspaceId = session.workspace.id;
  const settings = useQuery(() => session.store.getPresentationSettings(workspaceId), []);
  const profile = useQuery(() => session.store.getOutputProfile(workspaceId), []);
  const backgrounds = useQuery(() => session.store.listBackgrounds(workspaceId), []);
  const [fonts, setFonts] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [missing, setMissing] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [restoreFrom, setRestoreFrom] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void native.listFontFamilies().then(setFonts);
    void getVersion().then(setVersion);
  }, []);

  // Warn when the chosen font lacks characters the songs use.
  const fontFamily = profile?.fontFamily ?? null;
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (backgrounds ?? []).map(
        async (asset) => [asset.id, await native.backgroundUrl(asset.fileName)] as const,
      ),
    ).then((pairs) => !cancelled && setThumbs(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [backgrounds]);

  if (!settings || !profile || !backgrounds) return null;

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

  // Show sample lyrics when nothing is being presented, so settings can be judged.
  const sample: OutputFrame = status.frame.song
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
  const missingChars = Array.from(missing);

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-4 overflow-auto pr-1">
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
              <option value="">{t('settings.fontDefault')}</option>
              {profile.fontFamily && !fonts.includes(profile.fontFamily) && (
                <option value={profile.fontFamily}>{profile.fontFamily}</option>
              )}
              {fonts.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </label>
          {missingChars.length > 0 && (
            <p className="notice border-amber-500 bg-amber-900/30 text-amber-100">
              {t('settings.fontMissing', {
                count: missingChars.length,
                sample: missingChars.slice(0, 8).join(' '),
              })}
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
        </Section>

        <Section title={t('settings.background')}>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-40">{t('settings.backgroundColor')}</span>
            <input
              type="color"
              className="h-8 w-14 rounded border border-slate-600 bg-transparent"
              value={profile.backgroundColor}
              onChange={(e) =>
                void session.updateOutputProfile({ backgroundColor: e.target.value })
              }
            />
          </label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            <button
              className={`flex aspect-video items-center justify-center rounded-md border-2 text-xs ${
                profile.backgroundAssetId === null ? 'border-sky-400' : 'border-slate-600'
              }`}
              style={{ background: profile.backgroundColor }}
              onClick={() => void session.updateOutputProfile({ backgroundAssetId: null })}
            >
              <span className="rounded bg-black/60 px-1.5 py-0.5">
                {t('settings.backgroundNone')}
              </span>
            </button>
            {backgrounds.map((asset) => {
              const url = thumbs[asset.id];
              const selected = profile.backgroundAssetId === asset.id;
              return (
                <div
                  key={asset.id}
                  className={`relative aspect-video overflow-hidden rounded-md border-2 bg-black ${
                    selected ? 'border-sky-400' : 'border-slate-600'
                  }`}
                >
                  <button
                    className="absolute inset-0"
                    title={asset.originalName}
                    onClick={() =>
                      void session.updateOutputProfile({ backgroundAssetId: asset.id })
                    }
                  >
                    {url && asset.kind === 'image' && (
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    )}
                    {url && asset.kind === 'video' && (
                      <video
                        src={url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    )}
                    {url === null && (
                      <span className="text-xs text-amber-400">
                        {t('settings.backgroundMissing')}
                      </span>
                    )}
                  </button>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-xs">
                    {selected ? `✓ ${t('settings.backgroundSelected')} · ` : ''}
                    {asset.originalName}
                  </span>
                  <button
                    className="absolute top-1 right-1 rounded bg-black/70 px-1.5 text-xs hover:bg-rose-700"
                    title={t('common.remove')}
                    onClick={() => void removeBackground(asset)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <button className="btn" onClick={() => void importBackground()}>
            {t('settings.backgroundImport')}
          </button>
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

      <aside className="w-96 shrink-0 space-y-4 overflow-auto">
        <section className="panel space-y-2 p-3">
          <h2 className="label">{t('present.preview')}</h2>
          <SlidePreview frame={sample} />
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

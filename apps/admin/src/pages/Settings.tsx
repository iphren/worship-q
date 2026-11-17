import type { ChurchSettings } from '@worship-q/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Button, Card, ErrorText, INPUT, PageTitle } from '../ui';
import { useAction, useLoad } from '../useLoad';
import { t } from '@worship-q/i18n/admin';

/**
 * The church's defaults: a workspace's own setting wins over these, and these win over the
 * built-in default. "Not set" leaves the built-in default to the workspace.
 */
export function SettingsPage() {
  const load = useLoad(() => api.settings(), []);
  const settings = load.data?.settings ?? null;
  const apply = (next: ChurchSettings) => load.setData((d) => ({ ...d, settings: next }));

  return (
    <div className="space-y-4">
      <PageTitle loading={load.loading && load.data !== null}>{t('nav.settings')}</PageTitle>
      <p className="text-sm text-slate-400">{t('settings.intro')}</p>
      <ErrorText error={load.error} />
      {settings && (
        <div className="grid gap-4 md:grid-cols-2">
          <LinesPerPiece value={settings.linesPerPiece} onSaved={apply} />
          <WrapLongLines value={settings.wrapLongLines} onSaved={apply} />
          <FontFamily
            settingKey="slideshowFontFamily"
            title={t('settings.slideshowFont')}
            hint={t('settings.slideshowFontHint')}
            value={settings.slideshowFontFamily}
            onSaved={apply}
          />
          <FontFamily
            settingKey="subtitleFontFamily"
            title={t('settings.subtitleFont')}
            hint={t('settings.subtitleFontHint')}
            value={settings.subtitleFontFamily}
            onSaved={apply}
          />
        </div>
      )}
      {settings && (
        <RecordLiveAudio
          value={settings.recordLiveAudio}
          days={load.data?.recordingDays}
          onSaved={apply}
        />
      )}
      {settings && (
        <BibleVersions
          offered={settings.bibleVersions}
          defaults={settings.bibleDefaultVersions}
          onSaved={apply}
        />
      )}
    </div>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  youversion: 'YouVersion',
  apibible: 'API.Bible',
  esv: 'ESV API',
  freeuse: 'Free Use Bible API',
};

/**
 * The Bible versions the church offers its workspaces (B19). Each shows whether one of its
 * providers answers with the church's keys, set on the server (B17); the keys themselves
 * are never shown.
 */
function BibleVersions(props: {
  offered: string[] | undefined;
  defaults: string[] | undefined;
  onSaved(settings: ChurchSettings): void;
}) {
  const load = useLoad(() => api.bible(), []);
  const action = useAction();
  const offered = new Set(props.offered ?? []);
  const bible = load.data;

  async function toggle(id: string, on: boolean) {
    const next = (bible?.versions ?? [])
      .map((version) => version.id)
      .filter((v) => (v === id ? on : offered.has(v)));
    const result = await action.run(() =>
      api.setSetting('bibleVersions', next.length ? next : null),
    );
    if (result) props.onSaved(result.settings);
  }

  // The default versions, from those offered and available, in the catalogue's order.
  const choosable = (bible?.versions ?? []).filter((v) => offered.has(v.id) && v.available);
  const defaults = (props.defaults ?? []).filter((id) => choosable.some((v) => v.id === id));
  async function setDefault(index: 0 | 1, id: string) {
    const next = [...defaults];
    if (id) next[index] = id;
    else next.splice(index, 1);
    const cleaned = next.filter((v, i) => v && next.indexOf(v) === i).slice(0, 2);
    const result = await action.run(() =>
      api.setSetting('bibleDefaultVersions', cleaned.length ? cleaned : null),
    );
    if (result) props.onSaved(result.settings);
  }

  return (
    <Setting
      title={t('settings.bible')}
      hint={t('settings.bibleHint')}
      isSet={props.offered !== undefined}
    >
      <ErrorText error={load.error} />
      {bible && (
        <>
          <p className="mb-3 text-xs text-slate-400">
            {t('settings.keys', {
              youversion: t(bible.keys.youversion ? 'settings.keySet' : 'settings.keyNotSet'),
              apibible: t(bible.keys.apibible ? 'settings.keySet' : 'settings.keyNotSet'),
              esv: t(bible.keys.esv ? 'settings.keySet' : 'settings.keyNotSet'),
            })}
            {bible.checked ? '' : ` · ${t('settings.checking')}`}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-300">{t('settings.defaultFor')}</span>
            {([0, 1] as const).map((index) => (
              <select
                key={index}
                className={`${INPUT} w-auto`}
                aria-label={
                  index === 0 ? t('settings.defaultVersion') : t('settings.secondDefault')
                }
                value={defaults[index] ?? UNSET}
                disabled={action.busy || (index === 1 && !defaults[0])}
                onChange={(event) => void setDefault(index, event.target.value)}
              >
                <option value={UNSET}>
                  {index === 0 ? t('settings.noneFirstOffered') : t('settings.noSecond')}
                </option>
                {choosable
                  .filter((v) => v.id !== defaults[index === 0 ? 1 : 0])
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.credit} · {version.name}
                    </option>
                  ))}
              </select>
            ))}
          </div>
          <p className="-mt-2 mb-3 text-xs text-slate-500">{t('settings.sideBySide')}</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {bible.versions.map((version) => (
              <li key={version.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={offered.has(version.id)}
                    disabled={action.busy}
                    onChange={(event) => void toggle(version.id, event.target.checked)}
                  />
                  <span>
                    <span className="text-white">{version.credit}</span>{' '}
                    <span className="text-slate-400">{version.name}</span>
                    <span
                      className={`block text-xs ${version.available ? 'text-slate-500' : 'text-amber-300'}`}
                    >
                      {version.available
                        ? t('settings.through', {
                            providers: version.providers
                              .map((p) => PROVIDER_NAMES[p] ?? p)
                              .join(t('settings.then')),
                          })
                        : t('settings.notAvailable')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorText error={action.error} className="mt-2" />
    </Setting>
  );
}

/**
 * Whether the server records each workspace's live audio broadcast (service records R3): on
 * until an administrator turns it off, for every workspace at once.
 */
function RecordLiveAudio(props: {
  value: boolean | undefined;
  days: number | undefined;
  onSaved(settings: ChurchSettings): void;
}) {
  const action = useAction();
  const on = props.value !== false;
  async function change(next: boolean) {
    // On is the default, so turning it on again clears the setting.
    const result = await action.run(() => api.setSetting('recordLiveAudio', next ? null : false));
    if (result) props.onSaved(result.settings);
  }
  const kept =
    props.days === undefined
      ? null
      : props.days === 0
        ? t('settings.keptForever')
        : t('settings.keptDays', { days: props.days });
  return (
    <Card>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={on}
          disabled={action.busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>
          <span className="block font-semibold text-white">{t('settings.record')}</span>
          <span className="block text-sm text-slate-400">{t('settings.recordHint')}</span>
          {kept && <span className="mt-1 block text-xs text-slate-500">{kept}</span>}
        </span>
      </label>
      <ErrorText error={action.error} className="mt-2" />
    </Card>
  );
}

function Setting(props: { title: string; hint: string; isSet: boolean; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-white">{props.title}</h2>
        <span className={`text-xs ${props.isSet ? 'text-sky-300' : 'text-slate-500'}`}>
          {t(props.isSet ? 'settings.setForChurch' : 'settings.notSet')}
        </span>
      </div>
      <p className="mb-3 text-sm text-slate-400">{props.hint}</p>
      {props.children}
    </Card>
  );
}

const UNSET = '';

function LinesPerPiece(props: {
  value: number | undefined;
  onSaved(settings: ChurchSettings): void;
}) {
  const action = useAction();
  async function change(raw: string) {
    const value = raw === UNSET ? null : Number(raw);
    const result = await action.run(() => api.setSetting('linesPerPiece', value));
    if (result) props.onSaved(result.settings);
  }
  return (
    <Setting
      title={t('settings.linesPerPiece')}
      hint={t('settings.linesPerPieceHint')}
      isSet={props.value !== undefined}
    >
      <select
        className={INPUT}
        aria-label={t('settings.linesPerPiece')}
        value={props.value === undefined ? UNSET : String(props.value)}
        disabled={action.busy}
        onChange={(event) => void change(event.target.value)}
      >
        <option value={UNSET}>{t('settings.notSetDefault')}</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <option key={n} value={n}>
            {n === 1 ? '1 line' : `${n} lines`}
          </option>
        ))}
      </select>
      <ErrorText error={action.error} className="mt-2" />
    </Setting>
  );
}

function WrapLongLines(props: {
  value: boolean | undefined;
  onSaved(settings: ChurchSettings): void;
}) {
  const action = useAction();
  async function change(raw: string) {
    const value = raw === UNSET ? null : raw === 'on';
    const result = await action.run(() => api.setSetting('wrapLongLines', value));
    if (result) props.onSaved(result.settings);
  }
  return (
    <Setting
      title={t('settings.wrap')}
      hint={t('settings.wrapHint')}
      isSet={props.value !== undefined}
    >
      <select
        className={INPUT}
        aria-label={t('settings.wrap')}
        value={props.value === undefined ? UNSET : props.value ? 'on' : 'off'}
        disabled={action.busy}
        onChange={(event) => void change(event.target.value)}
      >
        <option value={UNSET}>{t('settings.notSetDefault')}</option>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
      <ErrorText error={action.error} className="mt-2" />
    </Setting>
  );
}

function FontFamily(props: {
  settingKey: 'slideshowFontFamily' | 'subtitleFontFamily';
  title: string;
  hint: string;
  value: string | null | undefined;
  onSaved(settings: ChurchSettings): void;
}) {
  const action = useAction();
  const saved = props.value ?? '';
  const [text, setText] = useState(saved);
  // Another administrator's change arriving on a refresh replaces an untouched field.
  useEffect(() => setText(saved), [saved]);
  const dirty = text.trim() !== saved;

  async function save(value: string | null) {
    const result = await action.run(() => api.setSetting(props.settingKey, value));
    if (result) props.onSaved(result.settings);
  }

  return (
    <Setting title={props.title} hint={props.hint} isSet={props.value != null}>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void save(text.trim());
        }}
      >
        <input
          className={`${INPUT} min-w-48 flex-1 basis-48`}
          aria-label={props.title}
          value={text}
          maxLength={100}
          placeholder={t('settings.builtIn')}
          disabled={action.busy}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            busy={action.busy}
            disabled={!dirty || !text.trim()}
          >
            {t('common.save')}
          </Button>
          <Button
            variant="ghost"
            disabled={props.value == null || action.busy}
            onClick={() => void save(null)}
          >
            {t('settings.useDefault')}
          </Button>
        </div>
      </form>
      <ErrorText error={action.error} className="mt-2" />
    </Setting>
  );
}

import type { ChurchSettings } from '@worship-q/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Button, Card, ErrorText, INPUT, PageTitle } from '../ui';
import { useAction, useLoad } from '../useLoad';

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
      <PageTitle loading={load.loading && load.data !== null}>Church defaults</PageTitle>
      <p className="text-sm text-slate-400">
        Defaults for every workspace. A setting a workspace chose for itself still wins; where a
        default is not set, the built-in one applies.
      </p>
      <ErrorText error={load.error} />
      {settings && (
        <div className="grid gap-4 md:grid-cols-2">
          <LinesPerPiece value={settings.linesPerPiece} onSaved={apply} />
          <WrapLongLines value={settings.wrapLongLines} onSaved={apply} />
          <FontFamily
            settingKey="slideshowFontFamily"
            title="Slideshow font"
            hint="The font of lyrics on the main screen."
            value={settings.slideshowFontFamily}
            onSaved={apply}
          />
          <FontFamily
            settingKey="subtitleFontFamily"
            title="Subtitle font"
            hint="The font of lyrics shown as subtitles over video."
            value={settings.subtitleFontFamily}
            onSaved={apply}
          />
        </div>
      )}
      {settings && <BibleVersions offered={settings.bibleVersions} onSaved={apply} />}
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

  return (
    <Setting
      title="Bible versions"
      hint="The versions workspaces may show. Each workspace picks up to two of these. A version needs one of its providers to answer with the keys set on the server."
      isSet={props.offered !== undefined}
    >
      <ErrorText error={load.error} />
      {bible && (
        <>
          <p className="mb-3 text-xs text-slate-400">
            Keys on the server: YouVersion {bible.keys.youversion ? 'set' : 'not set'} · API.Bible{' '}
            {bible.keys.apibible ? 'set' : 'not set'} · ESV {bible.keys.esv ? 'set' : 'not set'}
            {bible.checked ? '' : ' · checking versions…'}
          </p>
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
                        ? `Through ${version.providers.map((p) => PROVIDER_NAMES[p] ?? p).join(', then ')}`
                        : 'Not available with the keys set'}
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

function Setting(props: { title: string; hint: string; isSet: boolean; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-white">{props.title}</h2>
        <span className={`text-xs ${props.isSet ? 'text-sky-300' : 'text-slate-500'}`}>
          {props.isSet ? 'Set for the church' : 'Not set'}
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
      title="Lines per piece"
      hint="How many lines of a song go on one slide when it is split."
      isSet={props.value !== undefined}
    >
      <select
        className={INPUT}
        aria-label="Lines per piece"
        value={props.value === undefined ? UNSET : String(props.value)}
        disabled={action.busy}
        onChange={(event) => void change(event.target.value)}
      >
        <option value={UNSET}>Not set (built-in default)</option>
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
      title="Wrap long lines"
      hint="Whether a line too long for the screen continues on the next line instead of shrinking."
      isSet={props.value !== undefined}
    >
      <select
        className={INPUT}
        aria-label="Wrap long lines"
        value={props.value === undefined ? UNSET : props.value ? 'on' : 'off'}
        disabled={action.busy}
        onChange={(event) => void change(event.target.value)}
      >
        <option value={UNSET}>Not set (built-in default)</option>
        <option value="on">On</option>
        <option value="off">Off</option>
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
          placeholder="Built-in default"
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
            Save
          </Button>
          <Button
            variant="ghost"
            disabled={props.value == null || action.busy}
            onClick={() => void save(null)}
          >
            Use the default
          </Button>
        </div>
      </form>
      <ErrorText error={action.error} className="mt-2" />
    </Setting>
  );
}

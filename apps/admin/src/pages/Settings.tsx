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
    </div>
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

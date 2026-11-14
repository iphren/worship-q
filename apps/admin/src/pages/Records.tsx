/**
 * A workspace's service records for a day (service records R11, R19): the recordings of its
 * live audio broadcast, each with a player, its length and size, download and delete; and the
 * presentation log, each entry with its time, how long it was shown, and what it showed.
 */
import type { IsoDate, LocalLogEntry, RecordingView } from '@worship-q/protocol';
import { useState } from 'react';
import { api } from '../api';
import {
  dayRange,
  formatBytes,
  formatDate,
  formatDuration,
  formatTimeOfDay,
  runTime,
} from '../format';
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  ErrorText,
  INPUT,
  SectionTitle,
  Spinner,
} from '../ui';
import { useLoad } from '../useLoad';

const POLL_MS = 15_000;

/** The browser's own date. */
function todayHere(): IsoDate {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

export function RecordsSection({ id }: { id: string }) {
  const [date, setDate] = useState<IsoDate>(todayHere());
  const range = dayRange(date);
  const records = useLoad(() => api.records(id, range.from, range.to), [id, date], POLL_MS);
  const [removing, setRemoving] = useState<RecordingView | null>(null);
  const now = Date.now();

  return (
    <Card>
      <SectionTitle
        aside={
          <input
            type="date"
            className={`${INPUT} w-auto`}
            aria-label="Day"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
          />
        }
      >
        Records · {formatDate(date)}
      </SectionTitle>
      <ErrorText error={records.error} className="mb-2" />
      {!records.data && !records.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Loading…
        </p>
      )}
      {records.data && (
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-200">Live audio recordings</h3>
            {!records.data.recordingOn && (
              <p className="mb-2 text-xs text-amber-300">
                Recording is turned off in Settings: new broadcasts are not recorded.
              </p>
            )}
            {records.data.recordings.length === 0 ? (
              <p className="text-sm text-slate-400">No recording this day.</p>
            ) : (
              <ul className="space-y-3">
                {records.data.recordings.map((recording) => (
                  <RecordingRow
                    key={recording.id}
                    recording={recording}
                    now={now}
                    onRemove={() => setRemoving(recording)}
                  />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-200">Presentation log</h3>
            {records.data.log.length === 0 ? (
              <Empty>Nothing was presented this day.</Empty>
            ) : (
              <ol className="divide-y divide-slate-800">
                {records.data.log.map((entry) => (
                  <LogRow key={entry.id} entry={entry} now={now} />
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      {removing && (
        <Confirm
          title="Delete this recording?"
          confirmLabel="Delete"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.deleteRecording(removing.id);
            records.setData((d) => ({
              ...d,
              recordings: d.recordings.filter((r) => r.id !== removing.id),
            }));
            setRemoving(null);
          }}
        >
          <p>
            The recording from {formatTimeOfDay(removing.startedAt)} is removed from the server. It
            cannot be brought back.
          </p>
        </Confirm>
      )}
    </Card>
  );
}

function RecordingRow(props: { recording: RecordingView; now: number; onRemove(): void }) {
  const { recording } = props;
  const file = `/api/v1/admin/recordings/${encodeURIComponent(recording.id)}/file`;
  const ended =
    recording.endedAt ?? (recording.status === 'receiving' ? null : recording.lastChunkAt);
  return (
    <li className="rounded-lg border border-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-white">
          {formatTimeOfDay(recording.startedAt)}
          {ended ? ` – ${formatTimeOfDay(ended)}` : ''}
        </span>
        <span className="text-slate-400">
          {formatDuration(runTime(recording.startedAt, ended, props.now))} ·{' '}
          {formatBytes(recording.bytes)}
        </span>
        {recording.status === 'receiving' && <Badge tone="live">Recording</Badge>}
        {recording.status === 'interrupted' && <Badge tone="warn">Interrupted</Badge>}
        {recording.cutShort && <Badge tone="warn">Incomplete</Badge>}
        <span className="text-xs text-slate-500">
          {recording.inputName || 'Unknown input'} · {recording.deviceName}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <audio controls preload="none" src={file} className="h-9 min-w-0 flex-1 basis-64" />
        <a
          href={`${file}?download`}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700"
        >
          Download
        </a>
        <Button small variant="ghost" onClick={props.onRemove}>
          Delete
        </Button>
      </div>
    </li>
  );
}

function LogRow({ entry, now }: { entry: LocalLogEntry; now: number }) {
  const content = entry.content;
  const lines =
    content === null
      ? []
      : content.kind === 'lyrics' || content.kind === 'deck'
        ? content.lines
        : content.kind === 'passage'
          ? content.columns
              .slice(0, 1)
              .flatMap((column) =>
                column.units.map((unit) =>
                  `${unit.label} ${unit.lines.map((line) => line.text).join(' ')}`.trim(),
                ),
              )
          : content.kind === 'website'
            ? [content.url]
            : [];
  return (
    <li className="flex gap-3 py-2 text-sm">
      <span className="w-20 shrink-0 tabular-nums text-slate-400">
        {formatTimeOfDay(entry.startedAt)}
      </span>
      <span className="w-14 shrink-0 tabular-nums text-slate-500">
        {entry.endedAt ? formatDuration(runTime(entry.startedAt, entry.endedAt, now)) : 'Now'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-100">
          {content?.title ?? 'Not on the server yet'}
          {entry.previous && (
            <span className="ml-2 text-xs text-slate-500">previous run sheet</span>
          )}
        </span>
        {lines.length > 0 && (
          <span className="block truncate text-slate-400">{lines.join(' / ')}</span>
        )}
      </span>
    </li>
  );
}

import type { AdminStorage, StorageTotal, StorageType } from '@worship-q/protocol';
import { Fragment } from 'react';
import { api } from '../api';
import { formatBytes, usedPercent } from '../format';
import { Card, ErrorText, PageTitle, SectionTitle } from '../ui';
import { useLoad } from '../useLoad';

const TYPES: { type: StorageType; label: string }[] = [
  { type: 'deckImages', label: 'Slide images' },
  { type: 'deckOriginals', label: 'Original slide files' },
  { type: 'backgroundImages', label: 'Background images' },
  { type: 'backgroundVideos', label: 'Background videos' },
  { type: 'backups', label: 'Backups' },
  { type: 'database', label: 'Database' },
  { type: 'other', label: 'Other' },
];

const sum = (totals: Record<StorageType, StorageTotal>): StorageTotal =>
  TYPES.reduce(
    (acc, { type }) => ({
      bytes: acc.bytes + totals[type].bytes,
      files: acc.files + totals[type].files,
    }),
    { bytes: 0, files: 0 },
  );

/** A part of a whole, from 0 to 1. */
const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

const files = (n: number) => (n === 1 ? '1 file' : `${n.toLocaleString('en')} files`);

/** The storage monitor (media plan U11): a view only, nothing is removed from here. */
export function StoragePage() {
  const load = useLoad(() => api.storage(), []);
  const report: AdminStorage | null = load.data;
  return (
    <div className="space-y-4">
      <PageTitle loading={load.loading && load.data !== null}>Storage</PageTitle>
      <ErrorText error={load.error} />
      {report && (
        <>
          <Volume volume={report.volume} />
          <Card>
            <SectionTitle>By type</SectionTitle>
            <Table
              head={['Type', 'Size', 'Files']}
              rows={TYPES.map(({ type, label }) => [
                label,
                formatBytes(report.totals[type].bytes),
                files(report.totals[type].files),
              ])}
              shares={TYPES.map(({ type }) =>
                share(report.totals[type].bytes, sum(report.totals).bytes),
              )}
              foot={[
                'Total',
                formatBytes(sum(report.totals).bytes),
                files(sum(report.totals).files),
              ]}
            />
          </Card>
          <Card>
            <SectionTitle>By workspace</SectionTitle>
            {report.workspaces.length === 0 ? (
              <p className="text-sm text-slate-400">No workspace has files yet.</p>
            ) : (
              <WorkspaceTable workspaces={report.workspaces} />
            )}
          </Card>
          <Card>
            <SectionTitle>Could be freed</SectionTitle>
            <p className="text-sm text-slate-300">
              Original slide files of songs that were removed, or not used for six months:{' '}
              <strong className="text-white">
                {formatBytes(report.prunableDeckOriginals.bytes)}
              </strong>{' '}
              in {files(report.prunableDeckOriginals.files)}. The slides themselves stay; only the
              uploaded originals would go. Removing them is done on the server's command line.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Volume({ volume }: { volume: AdminStorage['volume'] }) {
  const percent = usedPercent(volume.freeBytes, volume.totalBytes);
  const used = Math.max(0, volume.totalBytes - volume.freeBytes);
  const tone = percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <Card>
      <SectionTitle
        aside={
          <span className="text-sm text-slate-300">
            <strong className="text-white">{formatBytes(volume.freeBytes)}</strong> free of{' '}
            {formatBytes(volume.totalBytes)}
          </span>
        }
      >
        Data volume
      </SectionTitle>
      <div
        role="meter"
        aria-label="Space used on the data volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% used, ${formatBytes(used)} of ${formatBytes(volume.totalBytes)}`}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {percent}% used ({formatBytes(used)}).{' '}
        {percent >= 90 && (
          <span className="text-red-300">The volume is nearly full; free space soon.</span>
        )}
      </p>
    </Card>
  );
}

function WorkspaceTable({ workspaces }: { workspaces: AdminStorage['workspaces'] }) {
  // Only the kinds of file some workspace has, so the table stays as narrow as it can.
  const shown = TYPES.filter(({ type }) => workspaces.some((w) => w.totals[type].bytes > 0));
  return (
    <Table
      head={['Workspace', ...shown.map((t) => t.label), 'Total']}
      rows={[...workspaces]
        .sort((a, b) => sum(b.totals).bytes - sum(a.totals).bytes)
        .map((w) => [
          w.id === 'church' ? 'Church Library' : w.name,
          ...shown.map(({ type }) =>
            w.totals[type].bytes > 0 ? formatBytes(w.totals[type].bytes) : '—',
          ),
          `${formatBytes(sum(w.totals).bytes)} · ${files(sum(w.totals).files)}`,
        ])}
    />
  );
}

/**
 * A table of sizes. With `shares`, a bar after the first column shows each row's part of
 * the total, so the biggest kinds of file stand out.
 */
function Table(props: { head: string[]; rows: string[][]; foot?: string[]; shares?: number[] }) {
  const cell = (index: number) => (index === 0 ? 'text-left' : 'text-right whitespace-nowrap');
  const { shares } = props;
  const barCell = <td className="w-full px-4" aria-hidden="true" />;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs tracking-wide text-slate-500 uppercase">
            {props.head.map((h, i) => (
              <Fragment key={i}>
                <th className={`pb-2 font-medium ${cell(i)}`}>{h}</th>
                {shares && i === 0 && (
                  <th className="px-4 pb-2 text-left font-medium">
                    <span className="sr-only">Share of the total</span>
                  </th>
                )}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, r) => (
            <tr key={r} className="group border-t border-slate-800">
              {row.map((value, i) => (
                <Fragment key={i}>
                  <td
                    className={`py-2 ${cell(i)} ${i === 0 ? 'whitespace-nowrap text-slate-100' : 'text-slate-300'}`}
                  >
                    {value}
                  </td>
                  {shares && i === 0 && <ShareBar share={shares[r] ?? 0} />}
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
        {props.foot && (
          <tfoot>
            <tr className="border-t border-slate-700 font-semibold text-white">
              {props.foot.map((value, i) => (
                <Fragment key={i}>
                  <td className={`pt-2 ${cell(i)}`}>{value}</td>
                  {shares && i === 0 && barCell}
                </Fragment>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** One row's part of the total as a bar, with the percentage on hover. */
function ShareBar({ share }: { share: number }) {
  const percent = share * 100;
  const text =
    share === 0
      ? 'None'
      : percent < 1
        ? 'Under 1% of the total'
        : `${Math.round(percent)}% of the total`;
  return (
    <td className="w-full min-w-24 px-4 py-2" title={text}>
      <div className="h-2 w-full rounded-full bg-slate-800">
        {share > 0 && (
          <div
            className="h-full rounded-full bg-sky-500 group-hover:bg-sky-400"
            // A sliver stays visible however small the part is.
            style={{ width: `max(${percent}%, 4px)` }}
          />
        )}
      </div>
      <span className="sr-only">{text}</span>
    </td>
  );
}

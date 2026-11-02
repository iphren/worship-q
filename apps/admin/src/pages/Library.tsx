import type { AdminLibraryItem, AdminLibraryUsage, LibraryKind } from '@worship-q/protocol';
import { useState } from 'react';
import { api } from '../api';
import { formatDate } from '../format';
import { Badge, Button, Confirm, Empty, ErrorText, PageTitle, Spinner, When } from '../ui';
import { useAction, useLoad } from '../useLoad';

const TABS: { kind: LibraryKind; label: string }[] = [
  { kind: 'song', label: 'Songs' },
  { kind: 'background', label: 'Backgrounds' },
];

export function LibraryPage() {
  const [kind, setKind] = useState<LibraryKind>('song');
  const [showDeleted, setShowDeleted] = useState(false);
  const list = useLoad(() => api.library(kind), [kind]);
  const items = (list.data?.items ?? []).filter((item) =>
    showDeleted ? item.removedAt !== null : item.removedAt === null,
  );
  const update = (next: AdminLibraryItem) =>
    list.setData((d) => ({ items: d.items.map((i) => (i.id === next.id ? next : i)) }));

  return (
    <div className="space-y-4">
      <PageTitle loading={list.loading && list.data !== null}>Church Library</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex rounded-lg bg-slate-900 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.kind}
              role="tab"
              aria-selected={kind === tab.kind}
              onClick={() => setKind(tab.kind)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                kind === tab.kind ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          Deleted
        </label>
      </div>
      <ErrorText error={list.error} />
      {showDeleted && (
        <p className="text-xs text-slate-400">
          Deleted items can be restored until their files are removed, 90 days after deletion by
          default. Workspaces keep any version of their own they had made.
        </p>
      )}
      {list.data && items.length === 0 && (
        <Empty>
          {showDeleted
            ? `No deleted ${kind === 'song' ? 'songs' : 'backgrounds'}.`
            : `The Church Library has no ${kind === 'song' ? 'songs' : 'backgrounds'}. A workspace that manages the Church Library fills it.`}
        </Empty>
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} onChanged={update} />
        ))}
      </ul>
    </div>
  );
}

function ItemRow(props: { item: AdminLibraryItem; onChanged(next: AdminLibraryItem): void }) {
  const { item } = props;
  const [deleting, setDeleting] = useState(false);
  const [usage, setUsage] = useState<AdminLibraryUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const restore = useAction();
  const deleted = item.removedAt !== null;
  const filesGone = item.filesRemovedAt !== null;

  function beginDelete() {
    setDeleting(true);
    setUsage(null);
    setUsageError(null);
    // Which run sheets use the item is shown before the question (D37).
    api
      .libraryUsage(item.kind, item.id)
      .then(setUsage, (cause: unknown) =>
        setUsageError(cause instanceof Error ? cause.message : 'Usage could not be loaded.'),
      );
  }

  async function doRestore() {
    const result = await restore.run(() => api.restoreLibraryItem(item.kind, item.id));
    if (result) props.onChanged({ ...item, removedAt: null });
  }

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        deleted ? 'border-slate-800/60 bg-slate-950' : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[15px] font-semibold ${deleted ? 'text-slate-300' : 'text-white'}`}
          >
            {item.title || 'Untitled'}
          </p>
          {item.fileName && <p className="truncate text-xs text-slate-500">{item.fileName}</p>}
        </div>
        {deleted ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              small
              variant="primary"
              busy={restore.busy}
              disabled={filesGone}
              title={filesGone ? 'Files were removed' : undefined}
              onClick={() => void doRestore()}
            >
              Restore
            </Button>
            {filesGone && <span className="text-xs text-amber-300">Files were removed</span>}
          </div>
        ) : (
          <Button small variant="ghost" onClick={beginDelete}>
            Delete
          </Button>
        )}
      </div>
      <ErrorText error={restore.error} className="mt-1" />
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
        <span>
          From{' '}
          <span className="text-slate-200">
            {item.fromWorkspace ? item.fromWorkspace.name : 'the church'}
          </span>
        </span>
        <span>
          Last changed <When iso={item.updatedAt} />
        </span>
        {item.removedAt && (
          <span>
            Deleted <When iso={item.removedAt} />
          </span>
        )}
        {item.filesRemovedAt && (
          <span>
            Files removed <When iso={item.filesRemovedAt} />
          </span>
        )}
      </p>
      {deleting && (
        <Confirm
          title={`Delete “${item.title || 'Untitled'}” from the Church Library?`}
          confirmLabel="Delete"
          danger
          ready={usage !== null || usageError !== null}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteLibraryItem(item.kind, item.id);
            props.onChanged({ ...item, removedAt: new Date().toISOString() });
            setDeleting(false);
          }}
        >
          <p>
            Every workspace loses it from the Church Library. It can be restored from the Deleted
            list until its files are removed. A workspace that made its own version keeps that
            version.
          </p>
          {!usage && !usageError && (
            <p className="flex items-center gap-2 text-slate-400">
              <Spinner /> Checking which run sheets use it…
            </p>
          )}
          <ErrorText error={usageError} />
          {usage && usage.workspaces.length === 0 && (
            <p className="text-slate-400">No workspace's run sheet uses it.</p>
          )}
          {usage && usage.workspaces.length > 0 && (
            <div>
              <p className="font-semibold text-slate-100">Used in these run sheets:</p>
              <ul className="mt-1 space-y-1">
                {usage.workspaces.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-slate-100">{w.name}</span>
                    <span className="text-xs text-slate-400">
                      {w.dates.map((date) => formatDate(date)).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                <Badge tone="warn">Those run sheets keep showing it until it is replaced.</Badge>
              </p>
            </div>
          )}
        </Confirm>
      )}
    </li>
  );
}

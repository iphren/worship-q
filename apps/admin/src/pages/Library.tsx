import type {
  AdminLibraryContent,
  AdminLibraryItem,
  AdminLibraryType,
  AdminLibraryUsage,
  LibraryKind,
} from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatDate } from '../format';
import { Badge, Button, Confirm, Empty, ErrorText, INPUT, PageTitle, Spinner, When } from '../ui';
import { useAction, useLoad } from '../useLoad';

type Tab = 'songs' | 'slides' | 'websites' | 'backgrounds';

const TABS: { tab: Tab; label: string; kind: LibraryKind; types: AdminLibraryType[] }[] = [
  { tab: 'songs', label: 'Songs', kind: 'song', types: ['lyrics'] },
  { tab: 'slides', label: 'Slides', kind: 'song', types: ['deck'] },
  { tab: 'websites', label: 'Websites', kind: 'song', types: ['website'] },
  { tab: 'backgrounds', label: 'Backgrounds', kind: 'background', types: ['image', 'video'] },
];

/** How long typing pauses before the search is sent. */
const SEARCH_DELAY_MS = 200;

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('songs');
  const { kind, types, label } = TABS.find((t) => t.tab === tab)!;
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useLoad(() => api.library(kind, query), [kind, query]);
  const items = (list.data?.items ?? []).filter(
    (item) =>
      types.includes(item.type) &&
      (showDeleted ? item.removedAt !== null : item.removedAt === null),
  );
  const update = (next: AdminLibraryItem) =>
    list.setData((d) => ({ items: d.items.map((i) => (i.id === next.id ? next : i)) }));

  // The item open in the preview; it stays open while it is in the list shown.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;
  const index = open ? items.indexOf(open) : -1;
  const step = (by: number) => {
    const next = items[index + by];
    if (next) setOpenId(next.id);
  };
  // Up and down move through the list while the preview is open, as in a mail app.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      if (event.key === 'ArrowDown' || event.key === 'j') stepRef.current(1);
      else if (event.key === 'ArrowUp' || event.key === 'k') stepRef.current(-1);
      else if (event.key === 'Escape') setOpenId(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (openId) {
      document
        .querySelector(`[data-item="${CSS.escape(openId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [openId]);

  const noun = label.toLowerCase();
  return (
    <div className="space-y-4">
      <PageTitle loading={list.loading && list.data !== null}>Church Library</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap rounded-lg bg-slate-900 p-1">
          {TABS.map((t) => (
            <button
              key={t.tab}
              role="tab"
              aria-selected={tab === t.tab}
              onClick={() => {
                setTab(t.tab);
                setOpenId(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
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
      <input
        type="search"
        className={INPUT}
        value={search}
        placeholder={
          kind === 'song'
            ? 'Search by title or words, in characters, pinyin or initials'
            : 'Search by name'
        }
        aria-label={`Search ${noun}`}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSearch('');
        }}
      />
      <ErrorText error={list.error} />
      {showDeleted && (
        <p className="text-xs text-slate-400">
          Deleted items can be restored until their files are removed, 90 days after deletion by
          default. Workspaces keep any version of their own they had made.
        </p>
      )}
      <div className={open ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-4' : ''}>
        <div>
          {list.data && items.length === 0 && (
            <Empty>
              {query.trim()
                ? `No ${showDeleted ? 'deleted ' : ''}${noun} match “${query.trim()}”.`
                : showDeleted
                  ? `No deleted ${noun}.`
                  : `The Church Library has no ${noun}. A workspace that manages the Church Library fills it.`}
            </Empty>
          )}
          <ul className="space-y-2">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={item.id === openId}
                onOpen={() => setOpenId(item.id === openId ? null : item.id)}
                onChanged={update}
              />
            ))}
          </ul>
        </div>
        {open && (
          <Preview
            item={open}
            position={`${index + 1} of ${items.length}`}
            onPrevious={index > 0 ? () => step(-1) : undefined}
            onNext={index < items.length - 1 ? () => step(1) : undefined}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </div>
  );
}

function ItemRow(props: {
  item: AdminLibraryItem;
  selected: boolean;
  onOpen(): void;
  onChanged(next: AdminLibraryItem): void;
}) {
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
      data-item={item.id}
      className={`rounded-xl border px-4 py-3 ${
        props.selected
          ? 'border-sky-500 bg-sky-950/40'
          : deleted
            ? 'border-slate-800/60 bg-slate-950'
            : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={props.onOpen}
          aria-expanded={props.selected}
          title="Show what it contains"
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <p
            className={`truncate text-[15px] font-semibold hover:underline ${deleted ? 'text-slate-300' : 'text-white'}`}
          >
            {item.title || 'Untitled'}
          </p>
          {item.fileName && <p className="truncate text-xs text-slate-500">{item.fileName}</p>}
        </button>
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
            {item.deletedBy && (
              <>
                {' by '}
                <span className="text-slate-200">
                  {'administrator' in item.deletedBy
                    ? item.deletedBy.administrator
                    : item.deletedBy.workspace.name}
                </span>
              </>
            )}
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

/**
 * What an item contains, beside the list on wide screens and over it on narrow ones. The
 * list stays usable, so an administrator can click through items one after another.
 */
function Preview(props: {
  item: AdminLibraryItem;
  position: string;
  onPrevious?(): void;
  onNext?(): void;
  onClose(): void;
}) {
  const { item } = props;
  const content = useLoad(
    async () => ({ id: item.id, content: await api.libraryContent(item.kind, item.id) }),
    [item.kind, item.id, item.revision],
  );
  // What was loaded for an earlier item is never shown for this one.
  const shown = content.data?.id === item.id ? content.data.content : null;
  const filesGone = item.filesRemovedAt !== null;
  return (
    <aside
      aria-label={`Contents of ${item.title || 'Untitled'}`}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-slate-700 bg-slate-900 shadow-2xl lg:sticky lg:top-8 lg:z-auto lg:max-h-[calc(100vh-4rem)] lg:max-w-none lg:rounded-xl lg:border lg:border-slate-800 lg:shadow-none"
    >
      <div className="flex items-start gap-2 border-b border-slate-800 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-white">{item.title || 'Untitled'}</h2>
          <p className="text-xs text-slate-400">
            {TYPE_LABEL[item.type]} · {props.position}
          </p>
        </div>
        <Button
          small
          variant="ghost"
          aria-label="Previous"
          title="Previous (↑)"
          disabled={!props.onPrevious}
          onClick={props.onPrevious}
        >
          ↑
        </Button>
        <Button
          small
          variant="ghost"
          aria-label="Next"
          title="Next (↓)"
          disabled={!props.onNext}
          onClick={props.onNext}
        >
          ↓
        </Button>
        <Button
          small
          variant="ghost"
          aria-label="Close"
          title="Close (Esc)"
          onClick={props.onClose}
        >
          ×
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ErrorText error={content.error} />
        {!shown && !content.error && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> Loading…
          </p>
        )}
        {shown && <Contents content={shown} filesGone={filesGone} />}
      </div>
    </aside>
  );
}

const TYPE_LABEL: Record<AdminLibraryType, string> = {
  lyrics: 'Song',
  deck: 'Slides',
  website: 'Website',
  image: 'Background image',
  video: 'Background video',
};

function Contents({ content, filesGone }: { content: AdminLibraryContent; filesGone: boolean }) {
  const gone = <p className="text-sm text-amber-300">Its files were removed.</p>;
  if ('fileName' in content) {
    if (filesGone) return gone;
    const src = api.fileUrl(content.fileName);
    return content.type === 'video' ? (
      <video
        key={src}
        src={src}
        autoPlay
        controls
        muted
        loop
        playsInline
        className="w-full rounded-lg bg-black"
      />
    ) : (
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt="" className="w-full rounded-lg bg-black" />
      </a>
    );
  }
  const facts = [
    ['Writers', content.author],
    ['Copyright', content.copyright],
    ['CCLI', content.ccli ?? ''],
    ['Year', content.year === null ? '' : String(content.year)],
  ].filter(([, value]) => value);
  return (
    <div className="space-y-4">
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {facts.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-slate-500">{name}</dt>
              <dd className="text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {content.websiteUrl && (
        <a
          href={content.websiteUrl}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-sky-400 hover:underline"
        >
          {content.websiteUrl} ↗
        </a>
      )}
      {content.deck &&
        (filesGone ? (
          gone
        ) : (
          <ol className="grid grid-cols-2 gap-2">
            {content.deck.pages.map((page) => (
              <li key={page.image}>
                <a
                  href={api.fileUrl(page.image)}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  <img
                    src={api.fileUrl(page.thumbnail ?? page.image)}
                    alt={`Slide ${page.slide}${page.step > 0 ? `, step ${page.step}` : ''}`}
                    loading="lazy"
                    style={{ aspectRatio: `${content.deck!.width} / ${content.deck!.height}` }}
                    className="w-full rounded bg-black object-contain"
                  />
                </a>
                <p className="mt-0.5 text-xs text-slate-500">
                  {page.slide}
                  {page.step > 0 ? `.${page.step}` : ''}
                </p>
              </li>
            ))}
          </ol>
        ))}
      {content.type === 'lyrics' &&
        (content.lyrics.trim() ? (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-100">
            {content.lyrics.trim()}
          </p>
        ) : (
          <p className="text-sm text-slate-400">No lyrics.</p>
        ))}
    </div>
  );
}

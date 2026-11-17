import type {
  AdminLibraryContent,
  AdminLibraryItem,
  AdminLibraryType,
  AdminLibraryUsage,
  LibraryKind,
} from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatDate, libraryTypeLabel, libraryTypeNoun } from '../format';
import { Badge, Button, Confirm, Empty, ErrorText, INPUT, PageTitle, Spinner, When } from '../ui';
import { useAction, useLoad } from '../useLoad';
import { formatNodes, t, type MessageKey } from '@worship-q/i18n/admin';

/** The `slides` library type is called Media: slide decks, PDFs, images and videos (U12). */
type Tab = 'songs' | 'slides' | 'websites' | 'backgrounds';

/** Each tab is named as the Church Library type it lists (`libraryTypeLabel`). */
const TABS: { tab: Tab; kind: LibraryKind; types: AdminLibraryType[] }[] = [
  { tab: 'songs', kind: 'song', types: ['lyrics'] },
  { tab: 'slides', kind: 'song', types: ['deck', 'imageItem', 'videoItem'] },
  { tab: 'websites', kind: 'song', types: ['website'] },
  { tab: 'backgrounds', kind: 'background', types: ['image', 'video'] },
];

/** How long typing pauses before the search is sent. */
const SEARCH_DELAY_MS = 200;

/** Whose content the page shows: the Church Library's, or how one workspace differs from it. */
type Scope = { workspaceId: string | null };

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('songs');
  const { kind, types } = TABS.find((entry) => entry.tab === tab)!;
  const workspaces = useLoad(() => api.workspaces(), []);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const workspace = workspaces.data?.workspaces.find((w) => w.id === workspaceId) ?? null;
  // The tabs are named as the Church Library types.
  const managesTab = workspace?.libraryTypes.includes(tab) ?? false;
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useLoad(
    async () => ({
      workspaceId,
      ...(await (workspaceId
        ? api.workspaceLibrary(workspaceId, kind, query)
        : api.library(kind, query))),
    }),
    [workspaceId, kind, query],
  );
  // A list loaded for another workspace is never shown for this one, whose rows differ.
  const loaded = list.data?.workspaceId === workspaceId ? list.data : null;
  const items = (loaded?.items ?? []).filter(
    (item) =>
      types.includes(item.type) &&
      (showDeleted ? item.removedAt !== null : item.removedAt === null),
  );
  const update = (next: AdminLibraryItem) =>
    list.setData((d) => ({ ...d, items: d.items.map((i) => (i.id === next.id ? next : i)) }));

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

  const noun = libraryTypeNoun(tab);
  return (
    <div className="space-y-4">
      <PageTitle loading={list.loading && list.data !== null}>{t('nav.library')}</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${INPUT} w-auto`}
          aria-label={t('library.whose')}
          value={workspaceId ?? ''}
          onChange={(event) => {
            setWorkspaceId(event.target.value || null);
            setOpenId(null);
          }}
        >
          <option value="">{t('nav.library')}</option>
          {workspaces.data?.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <div role="tablist" className="flex flex-wrap rounded-lg bg-slate-900 p-1">
          {TABS.map((entry) => (
            <button
              key={entry.tab}
              role="tab"
              aria-selected={tab === entry.tab}
              onClick={() => {
                setTab(entry.tab);
                setOpenId(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === entry.tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {libraryTypeLabel(entry.tab)}
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
          {t('library.deleted')}
        </label>
      </div>
      <input
        type="search"
        className={INPUT}
        value={search}
        placeholder={kind === 'song' ? t('library.searchSongs') : t('library.searchName')}
        aria-label={t('library.search', { noun })}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSearch('');
        }}
      />
      <ErrorText error={list.error ?? workspaces.error} />
      {workspace && !managesTab && !showDeleted && (
        <p className="text-xs text-slate-400">
          {t('library.differs', { workspace: workspace.name, noun })}
        </p>
      )}
      {showDeleted && (
        <p className="text-xs text-slate-400">
          {t('library.deletedHint')}
          {workspace && ` ${t('library.deletedHintWorkspace', { workspace: workspace.name })}`}
        </p>
      )}
      <div className={open ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-4' : ''}>
        <div>
          {!loaded && !list.error && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Spinner /> {t('common.loading')}
            </p>
          )}
          {loaded && items.length === 0 && (
            <Empty>
              {workspace && managesTab
                ? t('library.emptyManaged', { workspace: workspace.name, noun })
                : workspace && !query.trim()
                  ? showDeleted
                    ? t('library.emptyWorkspaceDeleted', { workspace: workspace.name, noun })
                    : t('library.emptyWorkspace', { workspace: workspace.name, noun })
                  : query.trim()
                    ? t(showDeleted ? 'library.noDeletedMatch' : 'library.noMatch', {
                        noun,
                        query: query.trim(),
                      })
                    : showDeleted
                      ? t('library.noDeleted', { noun })
                      : t('library.empty', { noun })}
            </Empty>
          )}
          <ul className="space-y-2">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                scope={{ workspaceId }}
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
            scope={{ workspaceId }}
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
  scope: Scope;
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
  // A workspace's content is changed on its devices; here it is only shown.
  const readOnly = props.scope.workspaceId !== null;
  const change = item.change;

  function beginDelete() {
    setDeleting(true);
    setUsage(null);
    setUsageError(null);
    // Which run sheets use the item is shown before the question (D37).
    api
      .libraryUsage(item.kind, item.id)
      .then(setUsage, (cause: unknown) =>
        setUsageError(cause instanceof Error ? cause.message : t('library.usageFailed')),
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
          title={t('library.showContents')}
          className="min-w-40 flex-1 cursor-pointer text-left"
        >
          <p
            className={`truncate text-[15px] font-semibold hover:underline ${deleted ? 'text-slate-300' : 'text-white'}`}
          >
            {item.title || t('common.untitled')}
          </p>
          {item.fileName && <p className="truncate text-xs text-slate-500">{item.fileName}</p>}
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {change && (
            <div className="flex flex-wrap justify-end gap-1">
              <Badge tone={CHANGE_TONE[change.type]}>{t(CHANGE_LABEL[change.type])}</Badge>
              {change.type === 'override' && change.usesChurchVersion && (
                <Badge tone="muted">{t('library.usesChurch')}</Badge>
              )}
              {change.type === 'override' && change.churchChangedSince && (
                <Badge tone="warn">{t('library.churchChanged')}</Badge>
              )}
            </div>
          )}
          {readOnly ? (
            filesGone && <span className="text-xs text-amber-300">{t('library.filesRemoved')}</span>
          ) : deleted ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                small
                variant="primary"
                busy={restore.busy}
                disabled={filesGone}
                title={filesGone ? t('library.filesRemoved') : undefined}
                onClick={() => void doRestore()}
              >
                {t('library.restore')}
              </Button>
              {filesGone && (
                <span className="text-xs text-amber-300">{t('library.filesRemoved')}</span>
              )}
            </div>
          ) : (
            <Button small variant="ghost" onClick={beginDelete}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>
      <ErrorText error={restore.error} className="mt-1" />
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
        {!readOnly && (
          <span>
            {formatNodes(t('library.from'), {
              source: (
                <span className="text-slate-200">
                  {item.fromWorkspace ? item.fromWorkspace.name : t('library.theChurch')}
                </span>
              ),
            })}
          </span>
        )}
        <span>
          {formatNodes(
            t(change?.type === 'hidden' ? 'library.hiddenWhen' : 'library.changedWhen'),
            {
              when: <When iso={item.updatedAt} />,
            },
          )}
        </span>
        {item.removedAt && (
          <span>
            {item.deletedBy
              ? formatNodes(t('library.deletedWhenBy'), {
                  when: <When iso={item.removedAt} />,
                  who: (
                    <span className="text-slate-200">
                      {'administrator' in item.deletedBy
                        ? item.deletedBy.administrator
                        : item.deletedBy.workspace.name}
                    </span>
                  ),
                })
              : formatNodes(t('library.deletedWhen'), { when: <When iso={item.removedAt} /> })}
          </span>
        )}
        {item.filesRemovedAt && (
          <span>
            {formatNodes(t('library.filesRemovedWhen'), {
              when: <When iso={item.filesRemovedAt} />,
            })}
          </span>
        )}
      </p>
      {deleting && (
        <Confirm
          title={t('library.deleteTitle', { title: item.title || t('common.untitled') })}
          confirmLabel={t('common.delete')}
          danger
          ready={usage !== null || usageError !== null}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteLibraryItem(item.kind, item.id);
            props.onChanged({ ...item, removedAt: new Date().toISOString() });
            setDeleting(false);
          }}
        >
          <p>{t('library.deleteText')}</p>
          {!usage && !usageError && (
            <p className="flex items-center gap-2 text-slate-400">
              <Spinner /> {t('library.checkingUsage')}
            </p>
          )}
          <ErrorText error={usageError} />
          {usage && usage.workspaces.length === 0 && (
            <p className="text-slate-400">{t('library.unused')}</p>
          )}
          {usage && usage.workspaces.length > 0 && (
            <div>
              <p className="font-semibold text-slate-100">{t('library.usedIn')}</p>
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
                <Badge tone="warn">{t('library.keepShowing')}</Badge>
              </p>
            </div>
          )}
        </Confirm>
      )}
    </li>
  );
}

const CHANGE_TONE: Record<
  NonNullable<AdminLibraryItem['change']>['type'],
  'accent' | 'warn' | 'muted'
> = {
  own: 'accent',
  override: 'warn',
  hidden: 'muted',
};

const CHANGE_LABEL: Record<NonNullable<AdminLibraryItem['change']>['type'], MessageKey> = {
  own: 'library.change.own',
  override: 'library.change.override',
  hidden: 'library.change.hidden',
};

/**
 * What an item contains, beside the list on wide screens and over it on narrow ones. The
 * list stays usable, so an administrator can click through items one after another.
 */
function Preview(props: {
  item: AdminLibraryItem;
  scope: Scope;
  position: string;
  onPrevious?(): void;
  onNext?(): void;
  onClose(): void;
}) {
  const { item } = props;
  const { workspaceId } = props.scope;
  const change = item.change;
  // A workspace's own version can be set beside the church's, to see what it changed.
  const [churchFor, setChurchFor] = useState<string | null>(null);
  const showChurch = churchFor === item.id;
  const churchId =
    change?.type === 'hidden' || (change?.type === 'override' && showChurch)
      ? change.churchId
      : null;
  const which = `${item.id}:${churchId ?? ''}`;
  const content = useLoad(
    async () => ({
      which,
      content:
        workspaceId === null
          ? await api.libraryContent(item.kind, item.id)
          : churchId !== null
            ? await api.libraryContent(item.kind, churchId)
            : await api.workspaceLibraryContent(workspaceId, item.kind, item.id),
    }),
    [workspaceId, item.kind, item.id, item.revision, churchId],
  );
  // What was loaded for an earlier item is never shown for this one.
  const shown = content.data?.which === which ? content.data.content : null;
  // The church's files are its own; a workspace's version may have been swept separately.
  const filesGone = churchId === null && item.filesRemovedAt !== null;
  const fileUrl = (name: string) =>
    workspaceId === null ? api.fileUrl(name) : api.workspaceFileUrl(workspaceId, name);
  return (
    <aside
      aria-label={t('library.contentsOf', { title: item.title || t('common.untitled') })}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-slate-700 bg-slate-900 shadow-2xl lg:sticky lg:top-8 lg:z-auto lg:max-h-[calc(100vh-4rem)] lg:max-w-none lg:rounded-xl lg:border lg:border-slate-800 lg:shadow-none"
    >
      <div className="flex items-start gap-2 border-b border-slate-800 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-white">
            {item.title || t('common.untitled')}
          </h2>
          <p className="text-xs text-slate-400">
            {t(TYPE_LABEL[item.type])} · {props.position}
          </p>
        </div>
        <Button
          small
          variant="ghost"
          aria-label={t('library.previous')}
          title={t('library.previousKey')}
          disabled={!props.onPrevious}
          onClick={props.onPrevious}
        >
          ↑
        </Button>
        <Button
          small
          variant="ghost"
          aria-label={t('library.next')}
          title={t('library.nextKey')}
          disabled={!props.onNext}
          onClick={props.onNext}
        >
          ↓
        </Button>
        <Button
          small
          variant="ghost"
          aria-label={t('library.close')}
          title={t('library.closeKey')}
          onClick={props.onClose}
        >
          ×
        </Button>
      </div>
      {change?.type === 'override' && (
        <div role="tablist" className="mx-4 mt-4 flex self-start rounded-lg bg-slate-950 p-1">
          {[false, true].map((church) => (
            <button
              key={String(church)}
              role="tab"
              aria-selected={showChurch === church}
              onClick={() => setChurchFor(church ? item.id : null)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                showChurch === church
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {church ? t('library.churchVersion') : t('library.itsVersion')}
            </button>
          ))}
        </div>
      )}
      {change?.type === 'hidden' && (
        <p className="mx-4 mt-4 text-xs text-slate-400">{t('library.hiddenHere')}</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ErrorText error={content.error} />
        {!shown && !content.error && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> {t('common.loading')}
          </p>
        )}
        {shown && <Contents content={shown} filesGone={filesGone} fileUrl={fileUrl} />}
      </div>
    </aside>
  );
}

const TYPE_LABEL: Record<AdminLibraryType, MessageKey> = {
  lyrics: 'library.type.lyrics',
  deck: 'library.type.deck',
  imageItem: 'library.type.imageItem',
  videoItem: 'library.type.videoItem',
  website: 'library.type.website',
  image: 'library.type.image',
  video: 'library.type.video',
};

function Contents({
  content,
  filesGone,
  fileUrl,
}: {
  content: AdminLibraryContent;
  filesGone: boolean;
  fileUrl(name: string): string;
}) {
  const gone = <p className="text-sm text-amber-300">{t('library.filesGone')}</p>;
  if ('fileName' in content) {
    if (filesGone) return gone;
    const src = fileUrl(content.fileName);
    return content.type === 'video' || content.type === 'videoItem' ? (
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
    [t('library.writers'), content.author],
    [t('library.copyright'), content.copyright],
    ['CCLI', content.ccli ?? ''],
    [t('library.year'), content.year === null ? '' : String(content.year)],
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
                <a href={fileUrl(page.image)} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={fileUrl(page.thumbnail ?? page.image)}
                    alt={
                      page.step > 0
                        ? t('library.slideStep', { slide: page.slide, step: page.step })
                        : t('library.slide', { slide: page.slide })
                    }
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
          <p className="text-sm text-slate-400">{t('library.noLyrics')}</p>
        ))}
    </div>
  );
}

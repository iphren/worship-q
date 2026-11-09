/**
 * The Bible window (P4.3, B1–B5, B11, B16): one search box that takes a reference or words,
 * the version chips, a breadcrumb, the book, chapter and verse grids, and a side-by-side
 * preview with the operator's warnings. Typing and browsing drive one selection.
 */
import {
  BOOKS,
  MAX_WORKSPACE_VERSIONS,
  align,
  bookName,
  chapterReference,
  describeWarning,
  formatReference,
  fromUsfm,
  passageReference,
  toUsfm,
  tocBook,
  tocInBibleOrder,
  type BibleLanguage,
  type BibleVersionInfo,
  type BookGroup,
  type IsoDate,
  type Passage,
  type Reference,
  type Song,
  type Toc,
} from '@worship-q/protocol';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BibleRequestError, workspaceVersions } from '../app/bible';
import {
  backTo,
  canContinue,
  checkReference,
  continueToNextChapter,
  isSelected,
  openAt,
  pickBook,
  pickChapter,
  pickVerse,
  selectedReference,
  typed,
  verseCells,
  type BibleWindowState,
} from '../app/bibleWindow';
import { useApp, useCloud, useSession } from '../app/context';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export type BibleWindowMode =
  /** Adding to a run sheet; `present` on the Present tab, where Present ▶ is offered (B6). */
  | { kind: 'add'; date: IsoDate; present: boolean }
  /** Editing a passage item: it keeps its place and its own versions (B11). */
  | { kind: 'edit'; song: Song };

const GROUPS: BookGroup[] = [
  'law',
  'history',
  'poetry',
  'prophets',
  'gospels',
  'acts',
  'letters',
  'revelation',
];

/** The window's versions: the workspace's setting, or the item's own when editing. */
function useVersions(mode: BibleWindowMode) {
  const { cloud } = useApp();
  const session = useSession();
  const [offered, setOffered] = useState<BibleVersionInfo[] | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(
    mode.kind === 'edit' ? (mode.song.passage?.texts.map((text) => text.version) ?? []) : null,
  );
  useEffect(() => {
    let cancelled = false;
    void cloud.bible.versions().then((list) => !cancelled && setOffered(list));
    if (mode.kind === 'add') {
      void session.store
        .getBibleVersions(session.workspace.id)
        .then((list) => !cancelled && setChosen(list));
    }
    return () => {
      cancelled = true;
    };
    // The workspace's setting is read once; the chips then change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const versions = useMemo(() => {
    if (!offered || !chosen) return [];
    if (mode.kind === 'edit') {
      // An item's versions apply as long as the church offers them.
      const ids = offered.map((v) => v.id);
      return chosen.filter((id) => ids.includes(id)).slice(0, MAX_WORKSPACE_VERSIONS);
    }
    return workspaceVersions(chosen, offered);
  }, [offered, chosen, mode.kind]);
  const change = (next: string[]) => {
    setChosen(next);
    // The chips change the workspace's setting, for every computer of it (B4); when editing,
    // only this item.
    if (mode.kind === 'add') void session.setBibleVersions(next);
  };
  return { offered, chosen: chosen ?? [], versions, change };
}

export function BibleWindow(props: {
  mode: BibleWindowMode;
  /** Opens at this reference, as from the song search (B9). */
  initial?: Reference | null;
  onClose(): void;
}) {
  const { mode, onClose } = props;
  const { cloud } = useApp();
  const status = useCloud();
  const session = useSession();
  const { offered, chosen, versions, change } = useVersions(mode);
  const first = versions[0] ?? null;
  const language: BibleLanguage = offered?.find((v) => v.id === first)?.language ?? 'en';
  const [toc, setToc] = useState<Toc | null>(null);
  const [state, setState] = useState<BibleWindowState>(() =>
    openAt(
      props.initial ??
        (mode.kind === 'edit' && mode.song.passage ? passageReference(mode.song.passage) : null),
      null,
      'en',
    ),
  );
  const [preview, setPreview] = useState<
    | { kind: 'idle' }
    | { kind: 'loading'; usfm: string }
    | { kind: 'ready'; passage: Passage; key: string }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const [results, setResults] = useState<
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'done'; references: string[]; searched: boolean }
  >({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Each opening is a reporting session of its own (B25).
    cloud.bible.newSession();
    inputRef.current?.focus();
  }, [cloud]);

  // The first version's contents, saved on this computer (B20).
  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    void cloud.bible.toc(first).then((loaded) => !cancelled && setToc(loaded));
    return () => {
      cancelled = true;
    };
  }, [cloud, first]);

  // A chapter whose verses are not known here yet is fetched once.
  const { book, chapter } = state;
  useEffect(() => {
    if (!first || !toc || !book || !chapter) return;
    const entry = tocBook(toc, book);
    if (!entry || entry.chapters[chapter - 1] !== null) return;
    let cancelled = false;
    void cloud.bible
      .tocWithChapter(first, book, chapter)
      .then((loaded) => !cancelled && loaded && setToc(loaded));
    return () => {
      cancelled = true;
    };
  }, [cloud, first, toc, book, chapter]);

  const check = checkReference(state, toc);
  const reference = check.kind === 'ok' ? check.reference : null;
  const usfm = reference ? toUsfm(reference) : null;
  const versionsKey = versions.join('|');

  // The preview follows the selection after a short pause, so typing stays quick.
  useEffect(() => {
    if (!reference || versions.length === 0) {
      setPreview({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const key = `${toUsfm(reference)}|${versionsKey}`;
    setPreview((current) =>
      current.kind === 'ready' && current.key === key ? current : { kind: 'loading', usfm: key },
    );
    const timer = window.setTimeout(() => {
      cloud.bible.passage(versions, reference).then(
        (passage) => !cancelled && setPreview({ kind: 'ready', passage, key }),
        (error: unknown) => {
          if (cancelled) return;
          const code = error instanceof BibleRequestError ? error.code : 'unavailable';
          setPreview({
            kind: 'failed',
            message:
              code === 'offline'
                ? t('bible.offline')
                : code === 'too-large'
                  ? t('bible.tooLarge')
                  : t('bible.failed', { message: (error as Error).message }),
          });
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `usfm` stands for the reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, usfm, versionsKey]);

  // Words are searched only when the text is not a reference, after a pause (§3.4).
  const searchText = state.searchText;
  useEffect(() => {
    if (!searchText || !first) {
      setResults({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setResults({ kind: 'searching' });
    const timer = window.setTimeout(() => {
      cloud.bible.search(first, searchText).then(
        (answer) => !cancelled && setResults({ kind: 'done', ...answer }),
        () => !cancelled && setResults({ kind: 'done', references: [], searched: true }),
      );
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cloud, searchText, first]);

  const versionName = (id: string) => offered?.find((v) => v.id === id)?.credit ?? id;
  const ready = preview.kind === 'ready' ? preview.passage : null;
  const aligned = useMemo(() => (ready ? align(ready) : null), [ready]);
  const presentable = mode.kind === 'add' && mode.present;

  async function finish(present: boolean) {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (mode.kind === 'edit') await session.savePassage(mode.song.id, ready);
      else await session.addPassage(mode.date, ready, { present });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    // Enter presents on the Present tab, else adds, once the preview is ready.
    void finish(presentable);
  }

  const connected = status.server !== null;
  const unavailable = !connected
    ? t('bible.needsChurch')
    : offered && offered.length === 0
      ? t('bible.notOfferedAny')
      : null;

  const go = (next: BibleWindowState) => {
    setState(next);
    inputRef.current?.focus();
  };

  return (
    <Dialog
      wide
      title={mode.kind === 'edit' ? t('bible.editTitle') : t('bible.title')}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {mode.kind === 'edit' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready || busy}
              onClick={() => void finish(false)}
            >
              {t('bible.save')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={presentable ? 'btn' : 'btn btn-primary'}
                disabled={!ready || busy}
                onClick={() => void finish(false)}
              >
                {t('bible.add')}
              </button>
              {presentable && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!ready || busy}
                  onClick={() => void finish(true)}
                >
                  {t('bible.present')}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="flex h-[70vh] min-h-0 flex-col gap-3">
        {unavailable && <p className="text-amber-300">{unavailable}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            className="field min-w-64 flex-1"
            type="search"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('bible.search')}
            value={state.input}
            onChange={(event) => setState(typed(event.target.value, toc))}
            onKeyDown={onInputKey}
          />
          <VersionChips
            offered={offered ?? []}
            chosen={chosen}
            versions={versions}
            onChange={change}
          />
        </div>
        {mode.kind === 'edit' && (
          <p className="text-xs text-slate-400">{t('bible.itemVersions')}</p>
        )}
        <Breadcrumb
          state={state}
          language={language}
          onBack={(level) => go(backTo(state, level, language))}
        />
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="min-h-0 w-1/2 overflow-auto rounded-md bg-slate-900/50 p-2">
            {state.searchText ? (
              <SearchResults
                results={results}
                language={language}
                version={first ? versionName(first) : ''}
                onPick={(ref) => go(typed(formatReference(ref, language), toc))}
              />
            ) : (
              <Grid state={state} toc={toc} language={language} onChange={go} />
            )}
            <Problem
              check={check}
              version={first ? versionName(first) : ''}
              language={language}
              onGo={(ref) => go(typed(formatReference(ref, language), toc))}
            />
          </div>
          <div className="min-h-0 w-1/2 overflow-auto rounded-md bg-slate-900/50 p-3">
            {preview.kind === 'loading' && <p className="text-slate-500">{t('bible.loading')}</p>}
            {preview.kind === 'failed' && <p className="text-amber-300">{preview.message}</p>}
            {aligned && ready && (
              <>
                {aligned.warnings.length > 0 && (
                  <div className="mb-2 rounded bg-slate-700/60 px-2 py-1 text-xs text-slate-200">
                    {t('bible.warnings')}
                    <ul className="list-inside list-disc">
                      {aligned.warnings.map((warning, i) => (
                        <li key={i}>{describeWarning(warning, aligned.reference.book)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <table className="w-full table-fixed border-separate border-spacing-x-3 text-sm">
                  <thead>
                    <tr>
                      {aligned.credits.map((credit, i) => (
                        <th key={i} className="text-left text-xs font-normal text-slate-500">
                          {credit}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aligned.rows.map((row) => (
                      <tr key={row.key}>
                        {row.cells.map((cell, i) => (
                          <td key={i} className="py-1 align-top text-slate-200">
                            {cell.map((unit, j) => (
                              <div key={j} className={unit.title ? 'italic text-slate-400' : ''}>
                                {unit.lines.map((line, k) => (
                                  <div key={k} style={{ paddingLeft: `${line.indent * 1.5}em` }}>
                                    {k === 0 && unit.label && (
                                      <sup className="mr-1 text-slate-500">{unit.label}</sup>
                                    )}
                                    {line.text}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {preview.kind === 'idle' && reference === null && check.kind === 'none' && (
              <p className="text-slate-500">{t('bible.preview')}</p>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** The chosen versions as chips, in column order, with + to add one (B4, B5). */
export function VersionChips(props: {
  offered: BibleVersionInfo[];
  chosen: string[];
  versions: string[];
  onChange(next: string[]): void;
}) {
  const { offered, chosen, onChange } = props;
  const offeredIds = offered.map((v) => v.id);
  const credit = (id: string) => offered.find((v) => v.id === id)?.credit ?? id;
  const shown = chosen.length > 0 ? chosen : props.versions;
  const addable = offered.filter((v) => !shown.includes(v.id));
  const full = shown.filter((id) => offeredIds.includes(id)).length >= MAX_WORKSPACE_VERSIONS;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((id, index) => {
        const gone = !offeredIds.includes(id);
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              gone ? 'bg-slate-800 text-slate-500 line-through' : 'bg-slate-600 text-slate-100'
            }`}
            title={gone ? t('bible.notOffered', { version: id }) : undefined}
          >
            {index > 0 && !gone && (
              <button
                type="button"
                className="text-slate-300 hover:text-white"
                aria-label={t('bible.moveFirst', { version: credit(id) })}
                title={t('bible.moveFirst', { version: credit(id) })}
                onClick={() => onChange([id, ...shown.filter((other) => other !== id)])}
              >
                ◀
              </button>
            )}
            {credit(id)}
            <button
              type="button"
              className="text-slate-300 hover:text-white"
              aria-label={t('bible.removeVersion', { version: credit(id) })}
              onClick={() => onChange(shown.filter((other) => other !== id))}
            >
              ✕
            </button>
          </span>
        );
      })}
      {addable.length > 0 && (
        <select
          className="field w-auto py-0.5 text-xs"
          aria-label={t('bible.addVersion')}
          title={full ? t('bible.twoVersions') : t('bible.addVersion')}
          disabled={full}
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (id) onChange([...shown.filter((v) => offeredIds.includes(v)), id]);
          }}
        >
          <option value="">+</option>
          {addable.map((version) => (
            <option key={version.id} value={version.id}>
              {version.credit} · {version.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Breadcrumb(props: {
  state: BibleWindowState;
  language: BibleLanguage;
  onBack(level: 'books' | 'chapters' | 'verses'): void;
}) {
  const { state, language } = props;
  const reference = selectedReference(state);
  let verses: string | null = null;
  if (reference && reference.verse !== null) {
    const { verse, endChapter, endVerse } = reference;
    verses =
      endChapter !== reference.chapter
        ? `${verse}–${endChapter}:${endVerse}`
        : endVerse === verse
          ? `${verse}`
          : `${verse}–${endVerse}`;
  }
  const crumb = 'rounded px-1 hover:bg-slate-700 hover:text-white';
  return (
    <nav className="flex items-center gap-1 text-sm text-slate-400" aria-label={t('bible.books')}>
      <button type="button" className={crumb} onClick={() => props.onBack('books')}>
        {t('bible.books')}
      </button>
      {state.book && (
        <>
          ›
          <button type="button" className={crumb} onClick={() => props.onBack('chapters')}>
            {bookName(state.book, language)}
          </button>
        </>
      )}
      {state.book && state.chapter && (
        <>
          ›
          <button type="button" className={crumb} onClick={() => props.onBack('verses')}>
            {state.first ? state.first.chapter : state.chapter}
          </button>
        </>
      )}
      {verses && (
        <>
          › <span className="text-slate-200">{verses}</span>
        </>
      )}
    </nav>
  );
}

const CELL =
  'min-w-9 rounded px-1.5 py-1 text-center text-sm tabular-nums hover:bg-slate-600 focus:ring-2 focus:ring-sky-400 focus:outline-none';

function Grid(props: {
  state: BibleWindowState;
  toc: Toc | null;
  language: BibleLanguage;
  onChange(next: BibleWindowState): void;
}) {
  const { state, toc, language, onChange } = props;
  if (state.level === 'books' || !state.book) {
    const listed = toc ? tocInBibleOrder(toc).map((entry) => entry.book) : BOOKS.map((b) => b.id);
    const shown = state.candidates ? listed.filter((id) => state.candidates!.includes(id)) : listed;
    const name = (id: string) =>
      (toc && language !== 'en' ? tocBook(toc, id)?.name : null) ?? bookName(id, language);
    return (
      <div className="space-y-3">
        {(['old', 'new'] as const).map((testament) => {
          const groups = GROUPS.map((group) => ({
            group,
            books: shown.filter((id) => {
              const book = BOOKS.find((b) => b.id === id);
              return book?.testament === testament && book.group === group;
            }),
          })).filter((g) => g.books.length > 0);
          if (groups.length === 0) return null;
          return (
            <section key={testament}>
              <h3 className="mb-1 text-xs font-semibold text-slate-400 uppercase">
                {testament === 'old' ? t('bible.oldTestament') : t('bible.newTestament')}
              </h3>
              {groups.map(({ group, books }) => (
                <div key={group} className="mb-1.5">
                  <div className="text-[11px] text-slate-500">{t(`bible.group.${group}`)}</div>
                  <div className="flex flex-wrap gap-1">
                    {books.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`${CELL} bg-slate-800`}
                        onClick={() => onChange(pickBook(state, id, language))}
                      >
                        {name(id)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  }
  if (state.level === 'chapters' || !state.chapter) {
    const count = (toc && tocBook(toc, state.book)?.chapters.length) ?? 0;
    return (
      <div>
        <h3 className="mb-1 text-xs font-semibold text-slate-400">{t('bible.chapters')}</h3>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`${CELL} bg-slate-800`}
              onClick={() => onChange(pickChapter(state, n, language))}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const cells = verseCells(state, toc);
  return (
    <div>
      <h3 className="mb-1 text-xs text-slate-400">{t('bible.verses')}</h3>
      {!cells && <p className="text-slate-500">{t('bible.loadingVerses')}</p>}
      <div className="flex flex-wrap gap-1">
        {cells?.map((cell) => {
          const selected = isSelected(state, state.chapter!, cell.verse);
          return (
            <button
              key={cell.verse}
              type="button"
              className={`${CELL} ${selected ? 'bg-sky-700 text-white' : 'bg-slate-800'}`}
              onClick={() => onChange(pickVerse(state, cell.verse, language))}
            >
              {cell.label}
            </button>
          );
        })}
      </div>
      {toc && canContinue(state, toc) && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-2"
          onClick={() => onChange(continueToNextChapter(state, toc, language))}
        >
          {t('bible.continue', { chapter: state.chapter + 1 })}
        </button>
      )}
    </div>
  );
}

function SearchResults(props: {
  results:
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'done'; references: string[]; searched: boolean };
  language: BibleLanguage;
  version: string;
  onPick(reference: Reference): void;
}) {
  const { results } = props;
  if (results.kind === 'searching' || results.kind === 'idle') {
    return <p className="text-slate-500">{t('bible.searching')}</p>;
  }
  if (!results.searched)
    return <p className="text-slate-500">{t('bible.noSearch', { version: props.version })}</p>;
  if (results.references.length === 0)
    return <p className="text-slate-500">{t('bible.noResults')}</p>;
  return (
    <ul className="space-y-1">
      {results.references.map((usfm) => {
        const reference = fromUsfm(usfm);
        if (!reference) return null;
        return (
          <li key={usfm}>
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left hover:bg-slate-700"
              onClick={() => props.onPick(reference)}
            >
              <Icon name="bible" className="mr-1 inline h-3.5 w-3.5 text-teal-300" />
              {formatReference(reference, props.language)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Why the reference cannot be shown, never clamped (B20): Psalm 151 offers Psalm 150. */
function Problem(props: {
  check: ReturnType<typeof checkReference>;
  version: string;
  language: BibleLanguage;
  onGo(reference: Reference): void;
}) {
  const { check, version, language } = props;
  if (check.kind === 'no-book')
    return <p className="mt-2 text-amber-300">{t('bible.noBook', { version })}</p>;
  if (check.kind === 'no-chapter') {
    const nearest = chapterReference(check.book, check.nearest);
    return (
      <p className="mt-2 text-amber-300">
        {t('bible.noChapter', {
          version,
          book: bookName(check.book, language),
          chapter: check.chapter,
          nearest: check.nearest,
        })}{' '}
        <button type="button" className="btn btn-sm" onClick={() => props.onGo(nearest)}>
          {t('bible.goTo', { book: bookName(check.book, language), chapter: check.nearest })}
        </button>
      </p>
    );
  }
  if (check.kind === 'no-verse') {
    return (
      <p className="mt-2 text-amber-300">
        {t('bible.noVerse', {
          version,
          verses: check.verses,
          book: bookName(check.reference.book, language),
          chapter: check.chapter,
        })}
      </p>
    );
  }
  return null;
}

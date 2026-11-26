/**
 * The phone's Bible screen (P7.3, B15, B26): the same search box, versions, grids and
 * side-by-side preview as the desktop's window, through the desktop the phone is connected
 * to. A passage is added after the presented item, or presented at once; never edited.
 */
import {
  BOOKS,
  align,
  bibleWindow,
  bookName,
  warningParams,
  type AlignWarning,
  formatReference,
  fromUsfm,
  toUsfm,
  tocBook,
  tocInBibleOrder,
  type BibleLanguage,
  type BibleVersionInfo,
  type Passage,
  type PassageColumn,
  type Toc,
} from '@worship-q/protocol';
import { useEffect, useMemo, useState } from 'react';
import { baseLocale, t, type MessageKey } from '@worship-q/i18n/remote';
import type { WorkspaceSource } from './source';

const {
  backTo,
  canContinue,
  checkReference,
  continueToNextChapter,
  INITIAL,
  isSelected,
  pickBook,
  pickChapter,
  pickVerse,
  typed,
  verseCells,
} = bibleWindow;
type BibleWindowState = bibleWindow.BibleWindowState;

const ERRORS: Record<string, MessageKey> = {
  offline: 'bible.error.offline',
  'not-offered': 'bible.error.notOffered',
  'not-found': 'bible.error.notFound',
  'too-large': 'bible.error.tooLarge',
  unavailable: 'bible.error.unavailable',
};

/** A joined or missing verse in the interface language. */
function warningText(warning: AlignWarning, book: string): string {
  return t(
    warning.kind === 'joined' ? 'bible.warningJoined' : 'bible.warningMissing',
    warningParams(warning, book, baseLocale()),
  );
}

export function PhoneBible(props: {
  connection: WorkspaceSource;
  connected: boolean;
  /** Text to open on, such as a reference typed into the library search. */
  initial?: string;
  onDone(added: string | null): void;
}) {
  const { connection, connected } = props;
  const [offered, setOffered] = useState<BibleVersionInfo[] | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [toc, setToc] = useState<Toc | null>(null);
  const [state, setState] = useState<BibleWindowState>(() =>
    props.initial ? typed(props.initial, null) : INITIAL,
  );
  const [preview, setPreview] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; passage: Passage }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const [results, setResults] = useState<{ references: string[]; searched: boolean } | null>(null);
  const first = versions[0] ?? null;
  const language: BibleLanguage = offered?.find((v) => v.id === first)?.language ?? 'en';

  useEffect(() => {
    if (!connected) return;
    void connection.bibleVersions().then((answer) => {
      if (!answer) return setOffered([]);
      setOffered(answer.offered);
      setVersions(answer.versions);
    });
  }, [connection, connected]);

  useEffect(() => {
    if (!first) return;
    void connection.bibleToc(first).then((answer) => answer?.toc && setToc(answer.toc));
  }, [connection, first]);

  const { book, chapter } = state;
  useEffect(() => {
    if (!first || !toc || !book || !chapter) return;
    if (tocBook(toc, book)?.chapters[chapter - 1] !== null) return;
    void connection
      .bibleToc(first, { book, chapter })
      .then((answer) => answer?.toc && setToc(answer.toc));
  }, [connection, first, toc, book, chapter]);

  const check = checkReference(state, toc);
  const reference = check.kind === 'ok' ? check.reference : null;
  const usfm = reference ? toUsfm(reference) : null;
  const versionsKey = versions.join('|');
  useEffect(() => {
    if (!usfm || versions.length === 0) return setPreview({ kind: 'idle' });
    let current = true;
    setPreview({ kind: 'loading' });
    const timer = setTimeout(() => {
      void connection.biblePassage(usfm, versions).then((answer) => {
        if (!current) return;
        if (answer?.passage) setPreview({ kind: 'ready', passage: answer.passage });
        else
          setPreview({
            kind: 'failed',
            message: t(ERRORS[answer?.error ?? 'unavailable'] ?? 'bible.error.unavailable'),
          });
      });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, usfm, versionsKey]);

  const searchText = state.searchText;
  useEffect(() => {
    if (!searchText || !first) return setResults(null);
    let current = true;
    const timer = setTimeout(() => {
      void connection
        .bibleSearch(first, searchText)
        .then((answer) => current && setResults(answer ?? { references: [], searched: true }));
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [connection, searchText, first]);

  const ready = preview.kind === 'ready' ? preview.passage : null;
  const aligned = useMemo(() => (ready ? align(ready) : null), [ready]);

  function changeVersions(next: string[]) {
    setVersions(next);
    connection.setBibleVersions(next);
  }

  function add(present: boolean) {
    if (!ready || !reference) return;
    connection.send({ type: 'addPassage', passage: ready, ...(present ? { present: true } : {}) });
    props.onDone(formatReference(reference, language));
  }

  const cell = 'min-w-10 rounded-lg px-2 py-2 text-center text-[15px] tabular-nums active:scale-95';
  const offeredIds = offered?.map((v) => v.id) ?? [];
  const credit = (id: string) => offered?.find((v) => v.id === id)?.credit ?? id;

  // On a phone on its side, a grid: the search and picker down the left, the passage and its
  // buttons beside them. The scrolling part is `contents` there, so its two halves, one
  // under the other when upright, take a column each.
  return (
    <div className="flex min-h-0 flex-1 flex-col land:grid land:grid-cols-[16rem_minmax(0,1fr)] land:grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="space-y-2 border-b border-slate-800 p-3 land:col-start-1 land:row-start-1 land:space-y-1.5 land:border-r land:py-2">
        <div className="flex gap-2">
          <input
            autoFocus
            type="search"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base"
            placeholder={t('bible.placeholder')}
            value={state.input}
            onChange={(event) => setState(typed(event.target.value, toc))}
          />
          <button
            className="rounded-lg bg-slate-800 px-3 text-sm font-semibold"
            onClick={() => props.onDone(null)}
          >
            {t('add.back')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {versions.map((id, index) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2.5 py-1 text-xs"
            >
              {index > 0 && (
                <button
                  aria-label={t('bible.showFirst', { version: credit(id) })}
                  onClick={() => changeVersions([id, ...versions.filter((v) => v !== id)])}
                >
                  ◀
                </button>
              )}
              {credit(id)}
              <button
                aria-label={t('bible.removeVersion', { version: credit(id) })}
                onClick={() => changeVersions(versions.filter((v) => v !== id))}
              >
                ✕
              </button>
            </span>
          ))}
          {offered && versions.length < 2 && offered.some((v) => !versions.includes(v.id)) && (
            <select
              className="rounded-full border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
              aria-label={t('bible.addVersion')}
              value=""
              onChange={(event) =>
                event.target.value &&
                changeVersions([
                  ...versions.filter((v) => offeredIds.includes(v)),
                  event.target.value,
                ])
              }
            >
              <option value="">+ {t('bible.version')}</option>
              {offered.map((v) => (
                <option key={v.id} value={v.id} disabled={versions.includes(v.id)}>
                  {v.credit}
                  {versions.includes(v.id) ? ` ${t('bible.selected')}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {offered && offered.length === 0 && (
          <p className="text-sm text-amber-300">{t('bible.noneOffered')}</p>
        )}
        <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
          <button onClick={() => setState(backTo(state, 'books', language))}>
            {t('bible.books')}
          </button>
          {state.book && (
            <>
              ›{' '}
              <button onClick={() => setState(backTo(state, 'chapters', language))}>
                {bookName(state.book, language)}
              </button>
            </>
          )}
          {state.book && state.chapter && (
            <>
              ›{' '}
              <button onClick={() => setState(backTo(state, 'verses', language))}>
                {state.first?.chapter ?? state.chapter}
              </button>
            </>
          )}
        </nav>
      </div>

      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 land:contents">
        <div className="space-y-4 land:col-start-1 land:row-span-2 land:row-start-2 land:min-h-0 land:overflow-y-auto land:border-r land:border-slate-800 land:px-3 land:py-2">
          {state.searchText ? (
            <ul className="space-y-1">
              {!results && <li className="text-sm text-slate-400">{t('bible.searching')}</li>}
              {results && !results.searched && (
                <li className="text-sm text-slate-400">{t('bible.noWordSearch')}</li>
              )}
              {results?.searched && results.references.length === 0 && (
                <li className="text-sm text-slate-400">{t('bible.noVerses')}</li>
              )}
              {results?.references.map((ref) => {
                const parsed = fromUsfm(ref);
                if (!parsed) return null;
                return (
                  <li key={ref}>
                    <button
                      className="w-full rounded-lg bg-slate-900 px-3 py-2 text-left"
                      onClick={() => setState(typed(formatReference(parsed, language), toc))}
                    >
                      📖 {formatReference(parsed, language)}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : state.level === 'books' || !state.book ? (
            <div className="flex flex-wrap gap-1.5">
              {(toc ? tocInBibleOrder(toc).map((b) => b.book) : BOOKS.map((b) => b.id))
                .filter((id) => !state.candidates || state.candidates.includes(id))
                .map((id) => (
                  <button
                    key={id}
                    className={`${cell} bg-slate-800`}
                    onClick={() => setState(pickBook(state, id, language))}
                  >
                    {bookName(id, language, true)}
                  </button>
                ))}
            </div>
          ) : state.level === 'chapters' || !state.chapter ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(
                { length: (toc && tocBook(toc, state.book)?.chapters.length) ?? 0 },
                (_, i) => i + 1,
              ).map((n) => (
                <button
                  key={n}
                  className={`${cell} bg-slate-800`}
                  onClick={() => setState(pickChapter(state, n, language))}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs text-slate-400">{t('bible.tapVerses')}</p>
              <div className="flex flex-wrap gap-1.5">
                {verseCells(state, toc)?.map((c) => (
                  <button
                    key={c.verse}
                    className={`${cell} ${isSelected(state, state.chapter!, c.verse) ? 'bg-sky-600 text-white' : 'bg-slate-800'}`}
                    onClick={() => setState(pickVerse(state, c.verse, language))}
                  >
                    {c.label}
                  </button>
                )) ?? <span className="text-sm text-slate-400">{t('bible.loading')}</span>}
              </div>
              {toc && canContinue(state, toc) && (
                <button
                  className="mt-2 text-sm text-sky-300"
                  onClick={() => setState(continueToNextChapter(state, toc, language))}
                >
                  {t('bible.continueChapter', { chapter: state.chapter + 1 })}
                </button>
              )}
            </div>
          )}
          {check.kind === 'no-chapter' && (
            <p className="text-sm text-amber-300">
              {t('bible.noChapter', { chapter: check.nearest })}
            </p>
          )}
          {check.kind === 'no-verse' && (
            <p className="text-sm text-amber-300">{t('bible.noVerse', { verses: check.verses })}</p>
          )}
        </div>

        <div className="space-y-4 land:col-start-2 land:row-span-2 land:row-start-1 land:min-h-0 land:overflow-y-auto land:px-3 land:py-2">
          {preview.kind === 'idle' && (
            <p className="hidden text-sm text-slate-500 land:block">{t('bible.choose')}</p>
          )}

          {preview.kind === 'loading' && (
            <p className="text-sm text-slate-400">{t('bible.loadingPassage')}</p>
          )}
          {preview.kind === 'failed' && <p className="text-sm text-amber-300">{preview.message}</p>}
          {aligned && (
            <section className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              {aligned.warnings.length > 0 && (
                <ul className="mb-2 text-xs text-slate-400">
                  {aligned.warnings.map((warning, i) => (
                    <li key={i}>ⓘ {warningText(warning, aligned.reference.book)}</li>
                  ))}
                </ul>
              )}
              <PassageColumns
                columns={aligned.versions.map((version, index) => ({
                  version,
                  credit: aligned.credits[index]!,
                  units: aligned.rows.flatMap((row) => row.cells[index] ?? []),
                }))}
              />
            </section>
          )}
        </div>
      </main>

      <div className="flex gap-2 border-t border-slate-800 p-3 land:col-start-2 land:row-start-3 land:py-2">
        <button
          className="flex-1 rounded-lg bg-slate-700 py-3 text-[15px] font-semibold whitespace-nowrap land:py-2.5 land:text-sm text-white active:scale-[0.98] disabled:opacity-40"
          disabled={!connected || !ready}
          onClick={() => add(false)}
        >
          {t('bible.add')}
        </button>
        <button
          className="flex-1 rounded-lg bg-sky-600 py-3 text-[15px] font-semibold whitespace-nowrap land:py-2.5 land:text-sm text-white active:scale-[0.98] disabled:opacity-40"
          disabled={!connected || !ready}
          onClick={() => add(true)}
        >
          {t('bible.present')} ▶
        </button>
      </div>
    </div>
  );
}

/** A passage's versions side by side, as on the slide. */
export function PassageColumns(props: { columns: PassageColumn[] }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${props.columns.length}, minmax(0, 1fr))` }}
    >
      {props.columns.map((column, index) => (
        <div key={index} className="min-w-0 text-[14px] leading-snug">
          {column.units.map((unit, i) => (
            <div key={i} className={unit.title ? 'text-slate-400 italic' : ''}>
              {unit.lines.map((line, j) => (
                <div key={j} style={{ paddingLeft: `${line.indent}em` }}>
                  {j === 0 && unit.label && (
                    <sup className="mr-0.5 text-slate-400">{unit.label}</sup>
                  )}
                  {line.text}
                </div>
              ))}
            </div>
          ))}
          <div className="mt-1 text-right text-[11px] text-slate-500">{column.credit}</div>
        </div>
      ))}
    </div>
  );
}

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
  describeWarning,
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
import type { RemoteConnection } from './connection';

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

const ERRORS: Record<string, string> = {
  offline: 'The presenting computer cannot reach the church server, or has no Bible.',
  'not-offered': 'That version is not offered by the church.',
  'not-found': 'That passage is not in this version.',
  'too-large': 'That passage is too long; choose at most 500 verses.',
  unavailable: 'The Bible is not answering just now. Try again.',
};

export function PhoneBible(props: {
  connection: RemoteConnection;
  connected: boolean;
  onDone(added: string | null): void;
}) {
  const { connection, connected } = props;
  const [offered, setOffered] = useState<BibleVersionInfo[] | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [toc, setToc] = useState<Toc | null>(null);
  const [state, setState] = useState<BibleWindowState>(INITIAL);
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
        else setPreview({ kind: 'failed', message: ERRORS[answer?.error ?? 'unavailable']! });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="flex gap-2">
          <input
            autoFocus
            type="search"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-base"
            placeholder="Mark 15:5-6, 马可福音15章5节, or words"
            value={state.input}
            onChange={(event) => setState(typed(event.target.value, toc))}
          />
          <button
            className="rounded-lg bg-slate-800 px-3 text-sm font-semibold"
            onClick={() => props.onDone(null)}
          >
            Back
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
                  aria-label={`Show ${credit(id)} first`}
                  onClick={() => changeVersions([id, ...versions.filter((v) => v !== id)])}
                >
                  ◀
                </button>
              )}
              {credit(id)}
              <button
                aria-label={`Remove ${credit(id)}`}
                onClick={() => changeVersions(versions.filter((v) => v !== id))}
              >
                ✕
              </button>
            </span>
          ))}
          {offered && versions.length < 2 && offered.some((v) => !versions.includes(v.id)) && (
            <select
              className="rounded-full border border-slate-600 bg-slate-900 px-2 py-1 text-xs"
              aria-label="Add a version"
              value=""
              onChange={(event) =>
                event.target.value &&
                changeVersions([
                  ...versions.filter((v) => offeredIds.includes(v)),
                  event.target.value,
                ])
              }
            >
              <option value="">+ Version</option>
              {offered.map((v) => (
                <option key={v.id} value={v.id} disabled={versions.includes(v.id)}>
                  {v.credit}
                  {versions.includes(v.id) ? ' (selected)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {offered && offered.length === 0 && (
          <p className="text-sm text-amber-300">
            The church does not offer a Bible on this computer.
          </p>
        )}
        <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
          <button onClick={() => setState(backTo(state, 'books', language))}>Books</button>
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

      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {state.searchText ? (
          <ul className="space-y-1">
            {!results && <li className="text-sm text-slate-400">Searching…</li>}
            {results && !results.searched && (
              <li className="text-sm text-slate-400">
                This version cannot be searched by words; type a reference.
              </li>
            )}
            {results?.searched && results.references.length === 0 && (
              <li className="text-sm text-slate-400">No verses found.</li>
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
            <p className="mb-2 text-xs text-slate-400">
              Tap the first verse, then the last. Tap one verse twice for that verse alone.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {verseCells(state, toc)?.map((c) => (
                <button
                  key={c.verse}
                  className={`${cell} ${isSelected(state, state.chapter!, c.verse) ? 'bg-sky-600 text-white' : 'bg-slate-800'}`}
                  onClick={() => setState(pickVerse(state, c.verse, language))}
                >
                  {c.label}
                </button>
              )) ?? <span className="text-sm text-slate-400">Loading…</span>}
            </div>
            {toc && canContinue(state, toc) && (
              <button
                className="mt-2 text-sm text-sky-300"
                onClick={() => setState(continueToNextChapter(state, toc, language))}
              >
                Continue into chapter {state.chapter + 1}
              </button>
            )}
          </div>
        )}
        {check.kind === 'no-chapter' && (
          <p className="text-sm text-amber-300">
            Not in this version: it ends at chapter {check.nearest}.
          </p>
        )}
        {check.kind === 'no-verse' && (
          <p className="text-sm text-amber-300">
            This chapter has only {check.verses} verses in this version.
          </p>
        )}

        {preview.kind === 'loading' && (
          <p className="text-sm text-slate-400">Loading the passage…</p>
        )}
        {preview.kind === 'failed' && <p className="text-sm text-amber-300">{preview.message}</p>}
        {aligned && (
          <section className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            {aligned.warnings.length > 0 && (
              <ul className="mb-2 text-xs text-slate-400">
                {aligned.warnings.map((warning, i) => (
                  <li key={i}>ⓘ {describeWarning(warning, aligned.reference.book)}</li>
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
      </main>

      <div className="flex gap-2 border-t border-slate-800 p-3">
        <button
          className="flex-1 rounded-lg bg-slate-700 py-3 text-[15px] font-semibold text-white active:scale-[0.98] disabled:opacity-40"
          disabled={!connected || !ready}
          onClick={() => add(false)}
        >
          Add to run sheet
        </button>
        <button
          className="flex-1 rounded-lg bg-sky-600 py-3 text-[15px] font-semibold text-white active:scale-[0.98] disabled:opacity-40"
          disabled={!connected || !ready}
          onClick={() => add(true)}
        >
          Present ▶
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

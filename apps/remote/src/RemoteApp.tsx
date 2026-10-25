import type { RemoteView } from '@worship-q/protocol';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RemoteConnection } from './connection';

const connection = new RemoteConnection(window.location);

export function RemoteApp() {
  const state = useSyncExternalStore(connection.subscribe, () => connection.state);
  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, []);

  switch (state.kind) {
    case 'name':
      return <NameForm />;
    case 'connecting':
      return <Message title="Connecting…" />;
    case 'pending':
      return (
        <Message title="Waiting for approval">
          <p>Ask the operator to approve this phone. They will see this code:</p>
          <p className="my-6 font-mono text-5xl tracking-[0.3em] text-white">{state.code}</p>
        </Message>
      );
    case 'offline':
      return (
        <Message title="Waiting for presentation">
          <p>The presenting computer is not connected right now. This page reconnects by itself.</p>
        </Message>
      );
    case 'denied':
      return (
        <Message title={state.reason === 'denied' ? 'Not approved' : 'Scan the QR code again'}>
          <p>
            {state.reason === 'denied'
              ? 'The operator did not approve this phone.'
              : state.reason === 'revoked'
                ? 'This phone was disconnected by the operator.'
                : 'This link has expired or was already used. Scan the QR code shown on the presenting computer.'}
          </p>
        </Message>
      );
    case 'no-workspace':
      return (
        <Message title="Presentation not found">This link does not lead to a presentation.</Message>
      );
    case 'update-needed':
      return (
        <Message title="Update needed">
          The presenting computer runs a different version of Worship Q. Update it, then reload.
        </Message>
      );
    case 'live':
      return <Live view={state.view} />;
  }
}

function Message(props: { title: string; children?: ReactNode }) {
  return (
    <main className="flex h-full flex-col items-center justify-center p-8 text-center">
      <h1 className="mb-3 text-xl font-semibold text-white">{props.title}</h1>
      <div className="max-w-sm text-sm text-slate-400">{props.children}</div>
    </main>
  );
}

function NameForm() {
  const [name, setName] = useState('');
  return (
    <main className="flex h-full flex-col items-center justify-center p-8">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) connection.start(name);
        }}
      >
        <h1 className="text-xl font-semibold text-white">Remote control</h1>
        <p className="text-sm text-slate-400">
          Enter your name. The operator sees it when approving this phone.
        </p>
        <input
          autoFocus
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-lg"
          value={name}
          maxLength={40}
          placeholder="Your name"
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="w-full rounded-lg bg-sky-600 py-3 text-lg font-semibold text-white disabled:opacity-40"
          disabled={!name.trim()}
        >
          Continue
        </button>
      </form>
    </main>
  );
}

function Live({ view }: { view: RemoteView | null }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // Set by this phone's Prev and Next, so the page follows only its own moves. Following
  // moves made elsewhere would scroll the page away from what this phone is about to tap.
  const followRef = useRef(false);
  const [activeInView, setActiveInView] = useState(true);
  const connected = connection.connected;
  const presentedItem = view?.presented?.itemId;
  const presentedPiece = view?.presented?.pieceId;
  const loaded = view !== null;
  useEffect(() => {
    if (followRef.current)
      activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    followRef.current = false;
  }, [presentedItem, presentedPiece]);

  // Offer the locate button while the presented slide is scrolled out of view.
  useEffect(() => {
    const active = activeRef.current;
    const main = mainRef.current;
    setActiveInView(true);
    if (!active || !main) return;
    const observer = new IntersectionObserver(
      ([entry]) => setActiveInView(entry!.intersectionRatio >= 0.5),
      { root: main, threshold: [0, 0.5, 1] },
    );
    observer.observe(active);
    return () => observer.disconnect();
  }, [presentedItem, presentedPiece, loaded]);

  function step(type: 'previous' | 'next') {
    followRef.current = true;
    connection.send({ type });
  }

  if (!view) return <Message title="Connecting…" />;
  const control = 'rounded-xl py-4 text-lg font-semibold active:scale-[0.98] disabled:opacity-40';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-white">{view.workspaceName}</h1>
          <p className="text-xs text-slate-400">
            {view.status === 'live' && view.date ? view.date : 'Presentation ended'}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            connected ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-800 text-amber-100'
          }`}
        >
          {connected ? 'Connected' : 'Reconnecting…'}
        </span>
      </header>

      {view.previousContent && (
        <p className="border-b border-amber-700 bg-amber-900/40 px-4 py-2 text-xs text-amber-100">
          Still presenting previous content until you choose a slide.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <main ref={mainRef} className="h-full space-y-5 overflow-y-auto px-3 py-4">
          {view.items.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">
              The run sheet has no songs yet.
            </p>
          )}
          {view.items.map((item) => (
            <section key={item.itemId}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-slate-300">
                {item.title || 'Untitled song'}
              </h2>
              <div
                className={`grid gap-2 ${item.pieces.some((p) => p.thumbnail) ? 'grid-cols-2' : ''}`}
              >
                {item.pieces.map((piece) => {
                  const active =
                    view.presented?.itemId === item.itemId && view.presented.pieceId === piece.id;
                  return (
                    <button
                      key={piece.id}
                      ref={active ? activeRef : undefined}
                      disabled={!connected}
                      onClick={() =>
                        connection.send({
                          type: 'playPiece',
                          itemId: item.itemId,
                          pieceId: piece.id,
                        })
                      }
                      className={`rounded-lg border text-left text-[15px] leading-snug ${piece.thumbnail ? 'p-1' : 'px-3 py-2'} ${
                        active
                          ? view.blank
                            ? 'border-amber-400 bg-amber-900/50'
                            : 'border-emerald-500 bg-emerald-900/50 text-white'
                          : // Alternate styles by block, as on the desktop.
                            (piece.block ?? 0) % 2 === 0
                            ? 'border-slate-700 bg-slate-900'
                            : 'border-sky-700 bg-sky-900/60'
                      }`}
                    >
                      {piece.thumbnail ? (
                        <img
                          src={`/api/v1/remote/files/${encodeURIComponent(connection.workspace)}/${encodeURIComponent(piece.thumbnail)}`}
                          alt={piece.lines.join(' ')}
                          loading="lazy"
                          className="block w-full rounded"
                        />
                      ) : (
                        piece.lines.map((line, index) => <div key={index}>{line || ' '}</div>)
                      )}
                    </button>
                  );
                })}
                {item.pieces.length === 0 && (
                  <p className="px-1 text-xs text-slate-500">This song has no lyrics.</p>
                )}
              </div>
            </section>
          ))}
        </main>
        {view.presented && !activeInView && (
          <button
            aria-label="Go to current slide"
            onClick={() =>
              activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }
            className={`absolute right-4 bottom-4 flex h-12 w-12 items-center justify-center rounded-full border bg-slate-900/90 shadow-lg shadow-black/50 active:scale-95 ${
              view.blank ? 'border-amber-400 text-amber-300' : 'border-emerald-500 text-emerald-300'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        )}
      </div>

      <footer className="grid grid-cols-4 gap-2 border-t border-slate-800 bg-slate-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          className={`${control} bg-slate-800`}
          disabled={!connected}
          onClick={() => step('previous')}
        >
          ‹ Prev
        </button>
        <button
          className={`${control} ${view.blank ? 'bg-amber-600 text-white' : 'bg-slate-800'}`}
          disabled={!connected}
          onClick={() => connection.send({ type: view.blank ? 'unblank' : 'blank' })}
        >
          {view.blank ? 'Show' : 'Blank'}
        </button>
        <button
          className={`${control} bg-slate-800`}
          disabled={!connected || (!view.presented && !view.previousContent)}
          onClick={() => connection.send({ type: 'clear' })}
        >
          Clear
        </button>
        <button
          className={`${control} bg-sky-600 text-white`}
          disabled={!connected}
          onClick={() => step('next')}
        >
          Next ›
        </button>
      </footer>
    </div>
  );
}

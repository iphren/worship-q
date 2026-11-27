import { t } from '@worship-q/i18n/desktop';
import {
  PhoneApp,
  PhoneListen,
  PhoneProvider,
  RemoteConnection,
  type Phone,
  type PhoneLink,
} from '@worship-q/phone';
import { useEffect, useState } from 'react';
import { native } from '../platform/native';
import { appSocket } from './appSocket';
import { listStore } from './listStore';
import { fileUrl, fromView, grantAccount, relayUrl, type RemoteEntry } from './remoteList';
import { appWays } from './ways';

/** The entry as the list has it now: its trusted devices change with each view. */
function current(entry: RemoteEntry): RemoteEntry {
  return listStore.list.entries.find((candidate) => candidate.id === entry.id) ?? entry;
}

/**
 * Opens the phone's connection to one workspace of the list (native apps plan M2.12): the
 * venue network or the relay, the phone's name from the list, its grant from the keychain.
 */
async function connect(entry: RemoteEntry): Promise<RemoteConnection> {
  const account = grantAccount(entry);
  let grant = await native.keychainGet(account).catch(() => null);
  const link: PhoneLink = {
    workspace: entry.workspace ?? entry.local ?? '',
    invite: entry.invite,
    lan: null,
    connect: () => {
      const now = current(entry);
      return appSocket(
        { relayUrl: relayUrl(now), workspace: now.workspace ?? '', trusted: now.devices },
        appWays,
      );
    },
    store: {
      name: () => listStore.list.phoneName,
      setName: (name) => listStore.set({ ...listStore.list, phoneName: name }),
      grant: () => grant,
      setGrant: (next) => {
        grant = next;
        if (next) {
          void native.keychainSet(account, next).catch(console.error);
        } else {
          void native.keychainDelete(account).catch(console.error);
          // A scan asks for approval again (N13).
          listStore.update(entry.id, (e) => ({ ...e, ended: true }));
        }
      },
    },
    fileUrl: (name) => fileUrl(current(entry), name),
    inviteUsed: () => listStore.update(entry.id, (e) => ({ ...e, invite: null })),
    suggestedName: () => native.deviceName(),
  };
  return new RemoteConnection(link);
}

/**
 * One workspace this phone controls: the shared phone screens over the app's connection,
 * under a bar that leads back to the list. Leaving closes the connection, so gestures never
 * reach another workspace (criterion 23).
 */
export function RemoteWorkspace(props: { entry: RemoteEntry; onBack(): void }) {
  const { entry, onBack } = props;
  const [phone, setPhone] = useState<Phone | null>(null);

  useEffect(() => {
    let active = true;
    let stop = () => undefined as void;
    void connect(entry).then((connection) => {
      if (!active) return;
      const listen = new PhoneListen(connection);
      const unsubscribe = connection.subscribe(() => {
        const state = connection.state;
        if (state.kind === 'live' && state.view) {
          const view = state.view;
          listStore.update(entry.id, (e) => fromView(e, view));
        }
      });
      stop = () => {
        unsubscribe();
        listen.stop();
        connection.stop();
      };
      setPhone({ connection, listen });
    });
    return () => {
      active = false;
      stop();
      setPhone(null);
    };
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <button className="flex min-h-11 items-center px-3 text-sky-300" onClick={onBack}>
          <span aria-hidden className="mr-1 text-xl leading-none">
            ‹
          </span>
          {t('mobile.back')}
        </button>
        <span className="min-w-0 flex-1 truncate pr-3 text-right text-sm text-slate-400">
          {current(entry).name}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {phone && (
          <PhoneProvider phone={phone}>
            <PhoneApp />
          </PhoneProvider>
        )}
      </div>
    </div>
  );
}

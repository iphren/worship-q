import { InvalidCodeError, UpdateNeededError, type JoinMode } from '@worship-q/sync';
import { useState } from 'react';
import { useApp, useCloud } from '../app/context';
import { t } from '../i18n';
import { ConfirmDialog, Dialog } from './Dialog';

function timeText(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Join = { workspaceName: string; churchEmpty: boolean; hasLocalContent: boolean };

/** Settings section: connect to a church instance, or the state of the connection. */
export function ChurchConnection() {
  const status = useCloud();
  // Enrolled but not joined, as when the app closed before a choice was made, starts over.
  return status.state?.joinedAt ? <Connected /> : <ConnectForm />;
}

function ConnectForm() {
  const { cloud } = useApp();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(t('church.deviceNameDefault'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [join, setJoin] = useState<Join | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await cloud.enroll(
        address,
        code,
        name.trim() || t('church.deviceNameDefault'),
      );
      // Nothing here to keep: simply take the church's content.
      if (!result.churchEmpty && !result.hasLocalContent) await cloud.join('replace');
      else setJoin(result);
    } catch (e) {
      setError(
        e instanceof InvalidCodeError
          ? t('church.invalidCode')
          : e instanceof UpdateNeededError
            ? t('church.updateNeeded')
            : t('church.unreachable', { error: String(e) }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function choose(mode: JoinMode) {
    setBusy(true);
    try {
      await cloud.join(mode);
    } catch (e) {
      setError(t('church.unreachable', { error: String(e) }));
      setJoin(null);
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <label className="flex items-center gap-3 text-sm">
        <span className="w-40 shrink-0">{t('church.address')}</span>
        <input
          className="field max-w-sm"
          value={address}
          placeholder={t('church.addressPlaceholder')}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-40 shrink-0">{t('church.code')}</span>
        <input
          className="field max-w-sm font-mono uppercase"
          value={code}
          placeholder={t('church.codePlaceholder')}
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-40 shrink-0">{t('church.deviceName')}</span>
        <input className="field max-w-sm" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <span className="w-40 shrink-0" />
        <button className="btn btn-primary" disabled={busy || !address.trim() || !code.trim()}>
          {busy ? t('church.connecting') : t('church.connect')}
        </button>
      </div>
      {error && <p className="notice border-rose-600 bg-rose-900/30 text-rose-100">{error}</p>}

      {join && (
        <Dialog
          title={t('church.joinTitle', { name: join.workspaceName })}
          onClose={() => !busy && setJoin(null)}
          actions={
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => setJoin(null)}>
                {t('common.cancel')}
              </button>
              {join.churchEmpty ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void choose('upload')}
                >
                  {t('church.joinUpload')}
                </button>
              ) : join.hasLocalContent ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void choose('merge')}
                  >
                    {t('church.joinMerge')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void choose('replace')}
                  >
                    {t('church.joinReplace')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void choose('replace')}
                >
                  {t('church.joinReceive')}
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <p>
              {join.churchEmpty
                ? t('church.joinUploadBody', { name: join.workspaceName })
                : join.hasLocalContent
                  ? t('church.joinChooseBody', { name: join.workspaceName })
                  : t('church.joinReplaceOnly', { name: join.workspaceName })}
            </p>
            <p className="text-xs text-slate-400">{t('church.joinBackupNote')}</p>
          </div>
        </Dialog>
      )}
    </form>
  );
}

function Connected() {
  const { cloud } = useApp();
  const status = useCloud();
  const [confirm, setConfirm] = useState(false);
  const state = status.state!;
  const { sync, relay, backup, live } = status;
  const connection = live?.transport === 'lan' ? t('church.viaLan') : t('church.viaRelay');
  const liveText =
    relay.kind === 'connecting'
      ? t('church.remoteConnecting')
      : relay.kind !== 'connected' || !live
        ? ''
        : live.role === 'coordinator'
          ? t('church.liveCoordinator')
          : live.role === 'viewer'
            ? t('church.liveViewer')
            : live.coordinatorName
              ? t('church.liveFollowing', { name: live.coordinatorName })
              : t('church.liveNobody');
  const canTakeOver = relay.kind === 'connected' && live?.role === 'follower';

  const syncText =
    sync.kind === 'syncing'
      ? t('church.syncing')
      : sync.kind === 'error'
        ? t('church.syncError', { error: sync.message })
        : sync.kind === 'update-needed'
          ? t('church.syncUpdateNeeded')
          : sync.kind === 'revoked'
            ? t('church.revoked')
            : state.lastSyncAt
              ? t('church.syncedAt', { time: timeText(state.lastSyncAt) })
              : t('church.neverSynced');
  const syncTone =
    sync.kind === 'error' || sync.kind === 'update-needed' || sync.kind === 'revoked'
      ? 'text-amber-300'
      : 'text-emerald-300';

  return (
    <div className="space-y-3 text-sm">
      <p>
        {t('church.connectedTo', {
          name: state.workspaceName ?? '',
          server: (state.server ?? '').replace(/^https?:\/\//, ''),
        })}
      </p>
      <p className={syncTone}>{syncText}</p>
      <p className="text-slate-300">
        {liveText}
        {relay.kind === 'connected' && live && (
          <span className="text-slate-500"> · {connection}</span>
        )}
        {canTakeOver && (
          <button
            className="btn btn-sm ml-2"
            title={t('church.takeOverHint')}
            onClick={() => cloud.takeOver()}
          >
            {live?.coordinatorLost ? t('live.carryOn') : t('church.takeOver')}
          </button>
        )}
      </p>
      {state.tokenStorage === 'database' && (
        <p className="text-xs text-amber-300">{t('church.tokenUnprotected')}</p>
      )}
      <p className="text-xs text-slate-400">
        {backup.kind === 'failed'
          ? t('church.backupFailed', { error: backup.message })
          : state.lastBackupAt
            ? t('church.lastBackup', { time: timeText(state.lastBackupAt) })
            : t('church.noBackup')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={sync.kind === 'syncing'}
          onClick={() => void cloud.sync()}
        >
          {t('church.syncNow')}
        </button>
        <button
          className="btn"
          disabled={backup.kind === 'running'}
          onClick={() => void cloud.backupNow()}
        >
          {backup.kind === 'running' ? t('church.backingUp') : t('church.backupNow')}
        </button>
        <span className="flex-1" />
        <button className="btn btn-ghost" onClick={() => setConfirm(true)}>
          {t('church.disconnect')}
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={t('church.disconnectTitle')}
          body={t('church.disconnectBody')}
          confirmLabel={t('church.disconnect').replace('…', '')}
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => void cloud.disconnect()}
        />
      )}
    </div>
  );
}

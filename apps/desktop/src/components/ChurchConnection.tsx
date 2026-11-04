import type { PairingStartResponse, ServerInfo } from '@worship-q/protocol';
import {
  CodesOffError,
  InvalidCodeError,
  TooManyPairingRequestsError,
  UpdateNeededError,
  type JoinMode,
} from '@worship-q/sync';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useApp, useCloud } from '../app/context';
import type { JoinPreview } from '../app/cloud';
import { canPair, joinMethod } from '../app/joinMethod';
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

/**
 * What is wrong with the church connection, to flag outside Settings; null when nothing is,
 * or when this computer is not connected to a church.
 */
export function useChurchProblem(): string | null {
  const { state, sync, backup, credentials } = useCloud();
  if (!state?.joinedAt) return null;
  if (sync.kind === 'revoked') return t('church.revoked');
  if (sync.kind === 'update-needed')
    return t(sync.by === 'server' ? 'church.syncUpdateNeededServer' : 'church.syncUpdateNeeded');
  if (credentials === 'refused') return t('church.tokenRefused');
  if (credentials === 'missing') return t('church.tokenMissing');
  if (sync.kind === 'error') return t('church.syncError', { error: sync.message });
  if (backup.kind === 'failed') return t('church.backupFailed', { error: backup.message });
  return null;
}

/** Settings section: connect to a church instance, or the state of the connection. */
export function ChurchConnection() {
  const status = useCloud();
  // Enrolled but not joined, as when the app closed before a choice was made, starts over.
  return status.state?.joinedAt ? <Connected /> : <ConnectForm />;
}

type Step =
  | { kind: 'address' }
  | { kind: 'code'; info: ServerInfo | null }
  | { kind: 'pairing'; info: ServerInfo | null; pairing: PairingStartResponse }
  | { kind: 'refused'; info: ServerInfo | null; reason: 'refused' | 'expired' };

function ConnectForm() {
  const { cloud } = useApp();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(t('church.deviceNameDefault'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [join, setJoin] = useState<JoinPreview | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'address' });

  const deviceName = () => name.trim() || t('church.deviceNameDefault');
  const failed = (e: unknown) =>
    setError(
      e instanceof CodesOffError
        ? t('church.codesOff')
        : e instanceof TooManyPairingRequestsError
          ? t('church.pairingBusy')
          : e instanceof InvalidCodeError
            ? t('church.invalidCode')
            : e instanceof UpdateNeededError
              ? t(e.by === 'server' ? 'church.updateNeededServer' : 'church.updateNeeded')
              : t('church.unreachable', { error: String(e) }),
    );

  /** Asks the instance how computers join it, then goes that way. */
  async function next() {
    setBusy(true);
    setError(null);
    try {
      const info = await cloud.probe(address);
      if (joinMethod(info) === 'pairing') await pair(info);
      else setStep({ kind: 'code', info });
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  async function pair(info: ServerInfo | null) {
    setError(null);
    try {
      const pairing = await cloud.startPairing(address, deviceName());
      setStep({ kind: 'pairing', info, pairing });
    } catch (e) {
      failed(e);
    }
  }

  async function connectWithCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await cloud.enroll(address, code, deviceName());
      await arrived(result);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  /** Enrolled, one way or the other: choose how this computer's content meets the church's. */
  async function arrived(result: JoinPreview) {
    // Nothing here to keep: simply take the church's content.
    if (!result.churchEmpty && !result.hasLocalContent) await cloud.join('replace');
    else setJoin(result);
  }

  // While pairing, ask the instance every few seconds whether an administrator decided. One
  // question at a time, so a slow answer is never overtaken by a later one. The approval is
  // kept for this computer until it first connects, so a question that fails on the way is
  // simply asked again.
  const pairing = step.kind === 'pairing' ? step.pairing : null;
  const pairingInfo = step.kind === 'pairing' ? step.info : null;
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let timer: number | undefined;
    const deadline = Date.parse(pairing.expiresAt) + pairing.intervalMs;
    const poll = async () => {
      try {
        const result = await cloud.pollPairing(pairing.secret, deviceName());
        if (cancelled) return;
        if (result.status === 'approved') {
          cancelled = true;
          arrived(result.join).catch(failed);
          return;
        }
        if (result.status !== 'pending') {
          setStep({ kind: 'refused', info: pairingInfo, reason: result.status });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof UpdateNeededError) {
          failed(e);
          setStep({ kind: 'code', info: pairingInfo });
          return;
        }
      }
      if (Date.now() > deadline) {
        setStep({ kind: 'refused', info: pairingInfo, reason: 'expired' });
        return;
      }
      timer = window.setTimeout(() => void poll(), pairing.intervalMs);
    };
    timer = window.setTimeout(() => void poll(), pairing.intervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

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

  const info = step.kind === 'address' ? null : step.info;

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (step.kind === 'address') void next();
        else if (step.kind === 'code') void connectWithCode();
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
          disabled={step.kind !== 'address'}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-3 text-sm">
        <span className="w-40 shrink-0">{t('church.deviceName')}</span>
        <input
          className="field max-w-sm"
          value={name}
          disabled={step.kind !== 'address'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {step.kind === 'code' && (
        <label className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0">{t('church.code')}</span>
          <input
            className="field max-w-sm font-mono uppercase"
            value={code}
            placeholder={t('church.codePlaceholder')}
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      {step.kind === 'pairing' && (
        <div className="flex max-w-xl flex-wrap items-center gap-4 rounded-md border border-slate-700 bg-slate-800/60 p-3 text-sm">
          <QrCode value={step.pairing.url} />
          <div className="min-w-48 flex-1 space-y-2">
            <p>{t('church.pairingIntro')}</p>
            <p className="font-mono text-2xl whitespace-nowrap tracking-[0.15em] text-white">
              {step.pairing.code}
            </p>
            <p className="text-xs text-slate-400">
              {t('church.pairingWaiting')}{' '}
              {t('church.pairingExpires', { time: timeText(step.pairing.expiresAt) })}
            </p>
          </div>
        </div>
      )}
      {step.kind === 'refused' && (
        <p className="notice ml-43 max-w-sm border-amber-600 bg-amber-900/30 text-amber-100">
          {t(step.reason === 'refused' ? 'church.pairingRefused' : 'church.pairingExpired')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-40 shrink-0" />
        {step.kind === 'address' && (
          <button className="btn btn-primary" disabled={busy || !address.trim()}>
            {busy ? t('church.connecting') : t('church.next')}
          </button>
        )}
        {step.kind === 'code' && (
          <button className="btn btn-primary" disabled={busy || !code.trim()}>
            {busy ? t('church.connecting') : t('church.connect')}
          </button>
        )}
        {step.kind === 'refused' && (
          <button type="button" className="btn btn-primary" onClick={() => void pair(step.info)}>
            {t('church.pair')}
          </button>
        )}
        {step.kind !== 'address' && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              setStep({ kind: 'address' });
              setError(null);
            }}
          >
            {t('common.cancel')}
          </button>
        )}
        {step.kind === 'code' && canPair(info) && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => void pair(step.info)}
          >
            {t('church.pairingAsk')}
          </button>
        )}
        {step.kind === 'pairing' && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => setStep({ kind: 'code', info: step.info })}
          >
            {t('church.pairingUseCode')}
          </button>
        )}
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

function QrCode(props: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(props.value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (markup) => !cancelled && setSvg(markup),
    );
    return () => {
      cancelled = true;
    };
  }, [props.value]);
  return (
    <div
      className="w-36 shrink-0 rounded-md bg-white p-2"
      // The markup is generated locally from the pairing link.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
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
          ? t(sync.by === 'server' ? 'church.syncUpdateNeededServer' : 'church.syncUpdateNeeded')
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
      {status.credentials === 'refused' && (
        <p className="text-amber-300">
          {t('church.tokenRefused')}
          <button className="btn btn-sm ml-2" onClick={() => cloud.retryCredentials()}>
            {t('church.tokenRetry')}
          </button>
        </p>
      )}
      {status.credentials === 'missing' && (
        <p className="text-amber-300">{t('church.tokenMissing')}</p>
      )}
      <p className="text-xs text-slate-400">
        {backup.kind === 'failed'
          ? t('church.backupFailed', { error: backup.message })
          : state.lastBackupAt
            ? t('church.lastBackup', { time: timeText(state.lastBackupAt) })
            : t('church.noBackup')}
      </p>
      {cloud.adminUrl && (
        <p className="text-xs text-slate-400">
          {t('church.adminAddress', { url: cloud.adminUrl.replace(/^https?:\/\//, '') })}
        </p>
      )}
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

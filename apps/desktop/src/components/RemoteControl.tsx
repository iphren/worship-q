import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useApp, useCloud, useRemoteHost, useSession } from '../app/context';
import { t } from '@worship-q/i18n/desktop';
import { Dialog } from './Dialog';

/** How often the QR code is redrawn, picking up a fresh invitation when one is made. */
const REFRESH_MS = 30_000;

function useInviteLink(): string | null {
  const { cloud } = useApp();
  const status = useCloud();
  const [link, setLink] = useState(() => cloud.remoteLink());
  useEffect(() => {
    // At once when the connection changes, as when the public server was just joined.
    setLink(cloud.remoteLink());
    const timer = window.setInterval(() => setLink(cloud.remoteLink()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [cloud, status.state, status.relay]);
  return link;
}

/**
 * Joins the public server when the panel opens in a workspace without a church server
 * (public server M3.6, M4.1): `failed` when it could not be reached, with a way to try again.
 */
function usePublicServer(): { failed: boolean; retry(): void } {
  const { cloud } = useApp();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!cloud.usesPublicServer) return;
    let active = true;
    setFailed(false);
    cloud.ensurePublic().catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [cloud, attempt]);
  return { failed, retry: () => setAttempt((n) => n + 1) };
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
      className="mx-auto w-56 rounded-md bg-white p-2"
      // The markup is generated locally from the invitation link.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Pending requests, wherever the operator is in the app. */
export function RemoteRequestsBanner() {
  const host = useRemoteHost();
  const requests = host.pending;
  if (requests.length === 0) return null;
  return (
    <div className="space-y-1 border-b border-sky-700 bg-sky-950 px-4 py-2">
      {requests.map((request) => (
        <div key={request.connection} className="flex items-center gap-3 text-sm text-sky-100">
          <span className="flex-1">
            {t('remote.banner', { name: request.name, code: request.code })}
          </span>
          <button className="btn btn-sm" onClick={() => host.deny(request.connection)}>
            {t('remote.deny')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void host.approve(request.connection)}
          >
            {t('remote.approve')}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Run-sheet edits made from phones, each with a way to undo it. */
export function RemoteEditsBanner() {
  const host = useRemoteHost();
  const notices = host.notices;
  if (notices.length === 0) return null;
  return (
    <div className="space-y-1 border-b border-slate-700 bg-slate-900 px-4 py-2">
      {notices.map((notice) => {
        const { change } = notice;
        const params = { name: notice.name, title: change.title || t('songs.untitled') };
        return (
          <div key={notice.id} className="flex items-center gap-3 text-sm text-slate-200">
            <span className="flex-1">
              {change.kind === 'moved'
                ? t('remote.moved', { ...params, position: change.toIndex + 1 })
                : t(change.kind === 'added' ? 'remote.added' : 'remote.removed', params)}
            </span>
            {notice.undoable && (
              <button className="btn btn-sm" onClick={() => void host.undo(notice.id)}>
                {t('remote.undo')}
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              title={t('common.close')}
              onClick={() => host.dismiss(notice.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function RemoteControlDialog(props: { onClose(): void }) {
  const { cloud, navigate } = useApp();
  const session = useSession();
  const status = useCloud();
  const host = useRemoteHost();
  const link = useInviteLink();
  const publicServer = usePublicServer();
  const [copied, setCopied] = useState(false);
  const { relay } = status;
  const isPublic = cloud.service?.kind === 'public';

  let body: React.ReactNode;
  if (session.isViewer) {
    body = <p>{t('remote.viewer')}</p>;
  } else if (cloud.usesPublicServer && publicServer.failed) {
    body = (
      <div className="space-y-3">
        <p>{t('remote.publicUnreachable')}</p>
        <button className="btn" onClick={publicServer.retry}>
          {t('media.tryAgain')}
        </button>
      </div>
    );
  } else if (cloud.usesPublicServer && !isPublic) {
    body = <p>{t('remote.joiningPublic')}</p>;
  } else if (!cloud.connected && !isPublic) {
    body = (
      <div className="space-y-3">
        <p>{t('remote.notConnected')}</p>
        <button
          className="btn"
          onClick={() => {
            props.onClose();
            navigate('settings');
          }}
        >
          {t('remote.openSettings')}
        </button>
      </div>
    );
  } else if (relay.kind !== 'connected' || !link) {
    body = <p>{t('remote.offline')}</p>;
  } else {
    body = (
      <div className="space-y-4">
        <QrCode value={link} />
        <p className="text-center text-xs text-slate-400">{t('remote.scan')}</p>
        {isPublic && (
          <p className="text-center text-xs text-slate-400">
            {t('remote.publicNote', { phones: status.server?.limits?.phones ?? 2 })}
          </p>
        )}
        <div className="flex justify-center">
          <button
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => setCopied(true));
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? t('remote.copied') : t('remote.copyLink')}
          </button>
        </div>

        {host.pending.length > 0 && (
          <section>
            <h3 className="label">{t('remote.requests')}</h3>
            <ul className="space-y-1">
              {host.pending.map((request) => (
                <li key={request.connection} className="flex items-center gap-2">
                  <span className="flex-1">{request.name}</span>
                  <span className="font-mono text-sky-200">
                    {t('remote.requestCode', { code: request.code })}
                  </span>
                  <button className="btn btn-sm" onClick={() => host.deny(request.connection)}>
                    {t('remote.deny')}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void host.approve(request.connection)}
                  >
                    {t('remote.approve')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="label">{t('remote.connected')}</h3>
          {host.connected.length === 0 ? (
            <p className="text-slate-400">{t('remote.none')}</p>
          ) : (
            <ul className="space-y-1">
              {host.connected.map((controller) => (
                <li key={controller.connection} className="flex items-center gap-2">
                  <span className="flex-1">{controller.name}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void host.disconnect(controller.connection)}
                  >
                    {t('remote.disconnect')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="text-xs text-slate-500">{t('remote.limits')}</p>
      </div>
    );
  }

  return (
    <Dialog
      title={t('remote.title')}
      onClose={props.onClose}
      actions={
        <>
          {(cloud.connected || isPublic) && !session.isViewer && (
            <button className="btn btn-danger" onClick={() => void host.disconnectAll()}>
              {t('remote.disconnectAll')}
            </button>
          )}
          <span className="flex-1" />
          <button className="btn" onClick={props.onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

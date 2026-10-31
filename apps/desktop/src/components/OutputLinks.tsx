import type { OutputKind, OutputLink } from '@worship-q/protocol';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useApp, useCloud } from '../app/context';
import { t } from '../i18n';
import { ConfirmDialog, Dialog } from './Dialog';

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
  // The markup is generated locally from the link.
  return (
    <div
      className="mx-auto w-48 rounded-md bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Settings → Outputs (decision D22, plan M7.6): links that show the slideshow or the subtitle
 * overlay in a browser through the church server. The token is in the link and shown once.
 */
export function OutputLinks(props: { localSlideshowUrl: string | null }) {
  const { cloud } = useApp();
  const { outputs, relay } = useCloud();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<OutputKind>('subtitle');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<OutputLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<OutputLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cloud.connected) void cloud.refreshOutputs().catch(() => undefined);
  }, [cloud, relay.kind]);

  if (!cloud.connected)
    return <p className="text-sm text-slate-400">{t('outputs.needsConnection')}</p>;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const link = await cloud.createOutput(kind, name);
      setCreated(link);
      setCreating(false);
      setName('');
    } catch (e) {
      setError(t('outputs.failed', { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: OutputLink) {
    setRevoking(null);
    setBusy(true);
    try {
      await cloud.revokeOutput(link.id);
    } catch (e) {
      setError(t('outputs.failed', { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {outputs.length === 0 ? (
        <p className="text-slate-400">{t('outputs.none')}</p>
      ) : (
        <ul className="divide-y divide-slate-700/60">
          {outputs.map((link) => (
            <li key={link.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{link.name}</span>
                <span className="block text-xs text-slate-400">
                  {t(
                    link.kind === 'slideshow' ? 'outputs.kind.slideshow' : 'outputs.kind.subtitle',
                  )}
                </span>
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setRevoking(link)}
              >
                {t('outputs.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <form
          className="space-y-2 rounded-md border border-slate-700 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0">{t('outputs.kind')}</span>
            <select
              className="field max-w-xs"
              value={kind}
              onChange={(e) => setKind(e.target.value as OutputKind)}
            >
              <option value="subtitle">{t('outputs.kind.subtitle')}</option>
              <option value="slideshow">{t('outputs.kind.slideshow')}</option>
            </select>
          </label>
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0">{t('outputs.name')}</span>
            <input
              className="field max-w-xs"
              value={name}
              placeholder={t('outputs.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {t('outputs.create')}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" disabled={busy} onClick={() => setCreating(true)}>
          {t('outputs.new')}
        </button>
      )}
      {error && <p className="notice border-rose-600 bg-rose-900/30 text-rose-100">{error}</p>}
      {props.localSlideshowUrl && (
        <div className="space-y-1 text-xs text-slate-400">
          <p>{t('outputs.localSlideshow')}</p>
          <code className="block truncate rounded bg-slate-900 px-2 py-1 text-slate-300 select-all">
            {props.localSlideshowUrl}
          </code>
        </div>
      )}

      {created?.url && (
        <Dialog
          title={created.name}
          onClose={() => setCreated(null)}
          actions={
            <button className="btn btn-primary" onClick={() => setCreated(null)}>
              {t('outputs.done')}
            </button>
          }
        >
          <div className="space-y-3">
            <p className="text-sm">{t('outputs.created')}</p>
            <QrCode value={created.url} />
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-slate-900 px-2 py-1 text-xs select-all">
                {created.url}
              </code>
              <button
                className="btn btn-sm shrink-0"
                onClick={() => {
                  void navigator.clipboard.writeText(created.url!).then(() => setCopied(true));
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? t('outputs.copied') : t('outputs.copy')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {revoking && (
        <ConfirmDialog
          title={t('outputs.revokeTitle', { name: revoking.name })}
          body={t('outputs.revokeBody')}
          confirmLabel={t('outputs.revoke')}
          danger
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke(revoking)}
        />
      )}
    </div>
  );
}

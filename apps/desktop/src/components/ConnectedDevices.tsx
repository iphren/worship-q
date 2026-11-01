import type { ConnectedDevice } from '@worship-q/protocol';
import { useState } from 'react';
import { useApp, useCloud, useRemoteHost } from '../app/context';
import { t, type MessageKey } from '../i18n';
import { ConfirmDialog } from './Dialog';

const ROLE_KEY: Record<ConnectedDevice['role'], MessageKey> = {
  coordinator: 'devices.role.coordinator',
  operator: 'devices.role.operator',
  viewer: 'devices.role.viewer',
  phone: 'devices.role.phone',
  output: 'devices.role.output',
};

/**
 * Everyone following the presentation, as the coordinator's snapshot lists them (plan M8.1,
 * M8.2): computers, phones and browser outputs, with how each is connected, and a way to
 * disconnect phones and outputs, singly or all at once (M8.3).
 */
export function ConnectedDevices() {
  const { cloud } = useApp();
  const { live, relay, state } = useCloud();
  const host = useRemoteHost();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!live || relay.kind !== 'connected') {
    return <p className="text-sm text-slate-400">{t('church.remoteConnecting')}</p>;
  }
  const devices = live.devices;
  const me = state?.deviceId ?? '';
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id;
  const outputId = (device: ConnectedDevice) => device.id.replace(/^output:/, '');

  async function disconnect(device: ConnectedDevice) {
    setBusy(true);
    try {
      if (device.role === 'phone') await host.revokeGrant(device.id);
      else if (device.role === 'output') await cloud.revokeOutput(outputId(device));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {devices.length <= 1 ? (
        <p className="text-slate-400">{t('devices.none')}</p>
      ) : (
        <ul className="divide-y divide-slate-700/60">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {device.name}
                  {device.id === me && (
                    <span className="text-slate-500"> · {t('output.thisScreen')}</span>
                  )}
                </span>
                <span className="block text-xs text-slate-400">
                  {t(ROLE_KEY[device.role])}
                  {device.via &&
                    device.via !== me &&
                    ` · ${t('devices.via', { name: nameOf(device.via) })}`}
                  {' · '}
                  {device.connection === 'lan' ? t('church.viaLan') : t('church.viaRelay')}
                  {device.missingFonts && device.missingFonts.length > 0 && (
                    <span className="text-amber-300"> · {device.missingFonts.join(', ')}</span>
                  )}
                </span>
              </span>
              {(device.role === 'phone' || device.role === 'output') && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void disconnect(device)}
                >
                  {t('devices.disconnect')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => setConfirmAll(true)}
        >
          {t('devices.disconnectAll')}
        </button>
      </div>
      {confirmAll && (
        <ConfirmDialog
          title={t('devices.disconnectAllTitle')}
          body={t('devices.disconnectAllBody')}
          confirmLabel={t('devices.disconnectAllConfirm')}
          danger
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => {
            setConfirmAll(false);
            void cloud.disconnectEverything();
          }}
        />
      )}
    </div>
  );
}

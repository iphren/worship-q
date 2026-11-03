import type { AdminDevice, AdminPairingRequest, AdminWorkspace } from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { expiryText, normalizePairingCode, orderDevices } from '../format';
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorText,
  INPUT,
  InlineForm,
  Notice,
  PageTitle,
  SectionTitle,
  When,
} from '../ui';
import { useAction, useLoad } from '../useLoad';

/** Pending requests are short-lived (fifteen minutes), so the page keeps itself fresh. */
const DEVICES_POLL_MS = 15_000;

export function DevicesPage({ pairCode }: { pairCode: string | null }) {
  const list = useLoad(() => api.devices(), [], DEVICES_POLL_MS);
  const workspaces = useLoad(() => api.workspaces(), []);
  const pending = list.data?.pending ?? [];
  const wanted = pairCode ? normalizePairingCode(pairCode) : null;
  const wantedPending = wanted
    ? pending.find((r) => normalizePairingCode(r.code) === wanted)
    : undefined;

  return (
    <div className="space-y-6">
      <PageTitle loading={list.loading && list.data !== null}>Devices</PageTitle>
      <ErrorText error={list.error} />

      <section>
        <SectionTitle>Pending requests</SectionTitle>
        {wanted && list.data && !wantedPending && (
          <div className="mb-3">
            <Notice tone="warning">
              The request <strong>{pairCode}</strong> is no longer pending. Requests last fifteen
              minutes; it may have expired, or another administrator handled it. Ask the computer to
              start pairing again if it still needs to join.
            </Notice>
          </div>
        )}
        {list.data && pending.length === 0 && (
          <p className="text-sm text-slate-400">
            No computer is waiting for approval. A new computer that starts pairing shows a code and
            appears here.
          </p>
        )}
        <ul className="space-y-2">
          {pending.map((request) => (
            <PendingRequest
              key={request.code}
              request={request}
              workspaces={workspaces.data?.workspaces ?? []}
              highlighted={wantedPending?.code === request.code}
              onDone={() => {
                list.reload();
                workspaces.reload();
              }}
            />
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Computers and phones</SectionTitle>
        {list.data && list.data.devices.length === 0 && <Empty>No device has joined yet.</Empty>}
        <ul className="space-y-2">
          {orderDevices(list.data?.devices ?? []).map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onChanged={(next) =>
                list.setData((d) => ({
                  ...d,
                  devices: d.devices.map((x) => (x.id === next.id ? next : x)),
                }))
              }
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PendingRequest(props: {
  request: AdminPairingRequest;
  workspaces: AdminWorkspace[];
  highlighted: boolean;
  onDone(): void;
}) {
  const { request, workspaces } = props;
  const [open, setOpen] = useState(props.highlighted);
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('');
  const [refusing, setRefusing] = useState(false);
  const approve = useAction();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.highlighted) ref.current?.scrollIntoView({ block: 'center' });
  }, [props.highlighted]);
  const chosen = workspaceId || (workspaces.length === 1 ? workspaces[0]!.id : '');

  async function submit() {
    const result = await approve.run(() =>
      api.approvePairing(request.code, chosen, name.trim() || null),
    );
    if (result) props.onDone();
  }

  return (
    <li
      ref={ref}
      className={`rounded-xl border p-4 ${
        props.highlighted ? 'border-sky-500 bg-sky-950/40' : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-xl tracking-[0.15em] text-white">{request.code}</span>
        <span className="min-w-0 flex-1 truncate text-[15px] text-slate-100">
          {request.deviceName || 'Unnamed computer'}
        </span>
        <span className="text-xs text-slate-400">
          Asked <When iso={request.createdAt} /> · {expiryText(request.expiresAt)}
        </span>
      </div>
      {open ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen) void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Workspace
              <select
                className={`${INPUT} mt-1`}
                value={chosen}
                onChange={(event) => setWorkspaceId(event.target.value)}
                required
              >
                <option value="">Choose a workspace…</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Name (optional)
              <input
                className={`${INPUT} mt-1`}
                value={name}
                maxLength={80}
                placeholder={request.deviceName || 'As the computer proposed'}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <ErrorText error={approve.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={approve.busy} disabled={!chosen}>
              Approve
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={approve.busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" small onClick={() => setOpen(true)}>
            Approve…
          </Button>
          <Button variant="danger" small onClick={() => setRefusing(true)}>
            Refuse
          </Button>
        </div>
      )}
      {refusing && (
        <Confirm
          title={`Refuse ${request.deviceName || 'this computer'}?`}
          confirmLabel="Refuse"
          danger
          onCancel={() => setRefusing(false)}
          onConfirm={async () => {
            await api.refusePairing(request.code);
            setRefusing(false);
            props.onDone();
          }}
        >
          <p>
            The computer showing code <strong>{request.code}</strong> is told it was refused and
            does not join. It can start pairing again later.
          </p>
        </Confirm>
      )}
    </li>
  );
}

function DeviceRow(props: { device: AdminDevice; onChanged(next: AdminDevice): void }) {
  const { device } = props;
  const revoked = device.revokedAt !== null;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [revoking, setRevoking] = useState(false);
  const rename = useAction();

  async function submitRename() {
    const result = await rename.run(() => api.renameDevice(device.id, name.trim()));
    if (!result) return;
    props.onChanged({ ...device, name: name.trim() });
    setRenaming(false);
  }

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        revoked ? 'border-slate-800/60 bg-slate-950 opacity-60' : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      {renaming ? (
        <InlineForm
          label="Device name"
          value={name}
          onChange={setName}
          placeholder="Device name"
          submitLabel="Save"
          busy={rename.busy}
          error={rename.error}
          autoFocus
          onSubmit={() => void submitRename()}
          onCancel={() => {
            setRenaming(false);
            rename.clear();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
            {device.name || 'Unnamed'}
          </span>
          {device.connected && !revoked && <Badge tone="live">Connected now</Badge>}
          {revoked && <Badge tone="warn">Revoked</Badge>}
          {!revoked && (
            <div className="flex gap-1">
              <Button
                small
                variant="ghost"
                onClick={() => {
                  setName(device.name);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
              <Button small variant="ghost" onClick={() => setRevoking(true)}>
                Revoke
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
        <span>
          Workspace <span className="text-slate-200">{device.workspaceName || '—'}</span>
        </span>
        <span>
          {device.enrolledBy === 'code'
            ? 'Joined with a connection code'
            : device.approvedBy
              ? `Paired, approved by ${device.approvedBy}`
              : 'Paired'}{' '}
          <When iso={device.createdAt} />
        </span>
        {revoked ? (
          <span>
            Revoked <When iso={device.revokedAt!} />
          </span>
        ) : (
          <span>
            Last seen <When iso={device.lastSeenAt} />
          </span>
        )}
      </p>
      {revoking && (
        <Confirm
          title={`Revoke ${device.name || 'this device'}?`}
          confirmLabel="Revoke"
          danger
          onCancel={() => setRevoking(false)}
          onConfirm={async () => {
            await api.revokeDevice(device.id);
            props.onChanged({
              ...device,
              revokedAt: new Date().toISOString(),
              connected: false,
            });
            setRevoking(false);
          }}
        >
          <p>
            The device is disconnected and can no longer reach{' '}
            <strong>{device.workspaceName}</strong>. Its copy of the content stays on it. To join
            again it must pair or use a connection code, like a new device.
          </p>
        </Confirm>
      )}
    </li>
  );
}

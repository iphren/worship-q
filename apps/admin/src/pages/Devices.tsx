import type { AdminDevice, AdminPairingRequest, AdminWorkspace } from '@worship-q/protocol';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { expiryText, groupDevicesByWorkspace, normalizePairingCode } from '../format';
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
export const DEVICES_POLL_MS = 15_000;

export function DevicesPage({ pairCode }: { pairCode: string | null }) {
  const list = useLoad(() => api.devices(), [], DEVICES_POLL_MS);
  const workspaces = useLoad(() => api.workspaces(), []);
  // Revoked devices are left out, except one revoked here, which stays until the page is left
  // so that the administrator sees the revocation happen.
  const [revokedHere, setRevokedHere] = useState<ReadonlySet<string>>(new Set());
  const devices = (list.data?.devices ?? []).filter(
    (d) => d.revokedAt === null || revokedHere.has(d.id),
  );
  const groups = groupDevicesByWorkspace(devices);
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
              churchLibraryEmpty={list.data?.churchLibraryEmpty ?? false}
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
        {list.data && devices.length === 0 && <Empty>No device has access to a workspace.</Empty>}
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.workspaceId}>
              <h3 className="mb-2 text-sm font-semibold text-slate-300">
                {group.workspaceName || 'Unnamed workspace'}
              </h3>
              <ul className="space-y-2">
                {group.devices.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    showWorkspace={false}
                    onChanged={(next) => {
                      if (next.revokedAt !== null)
                        setRevokedHere((ids) => new Set(ids).add(next.id));
                      list.setData((d) => ({
                        ...d,
                        devices: d.devices.map((x) => (x.id === next.id ? next : x)),
                      }));
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PendingRequest(props: {
  request: AdminPairingRequest;
  workspaces: AdminWorkspace[];
  churchLibraryEmpty: boolean;
  highlighted: boolean;
  onDone(): void;
}) {
  const { request, workspaces } = props;
  const [open, setOpen] = useState(props.highlighted);
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('');
  // Deliberately unset: the administrator must choose each time (no default).
  const [allowMerge, setAllowMerge] = useState<boolean | null>(null);
  const [refusing, setRefusing] = useState(false);
  const approve = useAction();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.highlighted) ref.current?.scrollIntoView({ block: 'center' });
  }, [props.highlighted]);
  const chosen = workspaceId || (workspaces.length === 1 ? workspaces[0]!.id : '');
  const workspaceHasContent = workspaces.find((w) => w.id === chosen)?.contentId != null;

  async function submit() {
    const result = await approve.run(() =>
      api.approvePairing(request.code, chosen, name.trim() || null, allowMerge!),
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
        <span className="min-w-40 flex-1 truncate text-[15px] text-slate-100">
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
            if (chosen && allowMerge !== null) void submit();
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
          <fieldset className="space-y-2 text-sm text-slate-300">
            <legend className="mb-1">
              If this computer already has songs and run sheets of its own
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`merge-${request.code}`}
                className="mt-1"
                checked={allowMerge === true}
                onChange={() => setAllowMerge(true)}
              />
              <span>
                <span className="text-slate-100">Allow merging</span>
                <span className="block text-xs text-slate-400">
                  It may keep them and add them to the workspace, alongside the workspace’s own.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`merge-${request.code}`}
                className="mt-1"
                checked={allowMerge === false}
                onChange={() => setAllowMerge(false)}
              />
              <span>
                <span className="text-slate-100">Don’t allow merging</span>
                <span className="block text-xs text-slate-400">
                  They are replaced by the workspace’s copy, so the workspace receives nothing from
                  it, even when the workspace has no content yet. A backup stays on the computer.
                </span>
              </span>
            </label>
          </fieldset>
          {allowMerge === false && props.churchLibraryEmpty && (
            <Notice tone="warning">
              This computer’s own songs and run sheets will be removed from it; only a backup in its
              data folder keeps them.{' '}
              {chosen && !workspaceHasContent
                ? 'The Church Library is empty and this workspace has no content yet, so this computer will start with no songs at all.'
                : 'The Church Library is empty, so this computer will have only the songs of the workspace it joins.'}
            </Notice>
          )}
          <ErrorText error={approve.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={approve.busy}
              disabled={!chosen || allowMerge === null}
            >
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

export function DeviceRow(props: {
  device: AdminDevice;
  onChanged(next: AdminDevice): void;
  /** Off on a workspace's own page, where every row is of that workspace. */
  showWorkspace?: boolean;
}) {
  const { device, showWorkspace = true } = props;
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
          <span className="min-w-40 flex-1 truncate text-[15px] font-semibold text-white">
            {device.name || 'Unnamed'}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
        {showWorkspace && (
          <span>
            Workspace <span className="text-slate-200">{device.workspaceName || '—'}</span>
          </span>
        )}
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

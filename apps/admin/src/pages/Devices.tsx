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
import { formatNodes, t } from '@worship-q/i18n/admin';

/** Pending requests are short-lived (fifteen minutes), so the page keeps itself fresh. */
export const DEVICES_POLL_MS = 15_000;

/** A request approved or refused on this page, kept until the page is left. */
type Handled =
  | { code: string; outcome: 'approved'; deviceName: string; workspaceId: string }
  | { code: string; outcome: 'refused'; deviceName: string };

export function DevicesPage({ pairCode }: { pairCode: string | null }) {
  const list = useLoad(() => api.devices(), [], DEVICES_POLL_MS);
  const workspaces = useLoad(() => api.workspaces(), []);
  // Revoked devices are left out, except one revoked here, which stays until the page is left
  // so that the administrator sees the revocation happen.
  const [revokedHere, setRevokedHere] = useState<ReadonlySet<string>>(new Set());
  // Requests handled here leave the pending list; remembering them lets the page confirm the
  // outcome instead of reporting the deep-linked code as expired.
  const [handled, setHandled] = useState<readonly Handled[]>([]);
  const devices = (list.data?.devices ?? []).filter(
    (d) => d.revokedAt === null || revokedHere.has(d.id),
  );
  const groups = groupDevicesByWorkspace(devices);
  const pending = list.data?.pending ?? [];
  const wanted = pairCode ? normalizePairingCode(pairCode) : null;
  const wantedPending = wanted
    ? pending.find((r) => normalizePairingCode(r.code) === wanted)
    : undefined;
  const wantedHandled = wanted
    ? handled.some((h) => normalizePairingCode(h.code) === wanted)
    : false;
  const workspaceName = (id: string) =>
    workspaces.data?.workspaces.find((w) => w.id === id)?.name || t('devices.itsWorkspace');

  return (
    <div className="space-y-6">
      <PageTitle loading={list.loading && list.data !== null}>{t('nav.devices')}</PageTitle>
      <ErrorText error={list.error} />

      <section>
        <SectionTitle>{t('devices.pending')}</SectionTitle>
        {handled.length > 0 && (
          <div className="mb-3 space-y-2">
            {handled.map((h) => (
              <Notice
                key={h.code}
                tone={h.outcome === 'approved' ? 'success' : 'info'}
                onClose={() => setHandled((all) => all.filter((x) => x.code !== h.code))}
              >
                {h.outcome === 'approved' ? (
                  <p>
                    {formatNodes(t('devices.approved'), {
                      device: <strong>{h.deviceName}</strong>,
                      workspace: <strong>{workspaceName(h.workspaceId)}</strong>,
                    })}
                  </p>
                ) : (
                  <p>
                    {formatNodes(t('devices.refused'), {
                      code: <strong>{h.code}</strong>,
                      device: <strong>{h.deviceName}</strong>,
                    })}
                  </p>
                )}
              </Notice>
            ))}
          </div>
        )}
        {wanted && list.data && !wantedPending && !wantedHandled && (
          <div className="mb-3">
            <Notice tone="warning">
              {formatNodes(t('devices.notPending'), { code: <strong>{pairCode}</strong> })}
            </Notice>
          </div>
        )}
        {list.data && pending.length === 0 && (
          <p className="text-sm text-slate-400">{t('devices.noneWaiting')}</p>
        )}
        <ul className="space-y-2">
          {pending.map((request) => (
            <PendingRequest
              key={request.code}
              request={request}
              workspaces={workspaces.data?.workspaces ?? []}
              churchLibraryEmpty={list.data?.churchLibraryEmpty ?? false}
              highlighted={wantedPending?.code === request.code}
              onDone={(outcome) => {
                setHandled((all) => [...all.filter((h) => h.code !== outcome.code), outcome]);
                list.reload();
                workspaces.reload();
              }}
            />
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>{t('devices.all')}</SectionTitle>
        {list.data && devices.length === 0 && <Empty>{t('devices.none')}</Empty>}
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.workspaceId}>
              <h3 className="mb-2 text-sm font-semibold text-slate-300">
                {group.workspaceName || t('devices.unnamedWorkspace')}
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
  onDone(outcome: Handled): void;
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
    if (result)
      props.onDone({
        code: request.code,
        outcome: 'approved',
        deviceName: result.device.name || request.deviceName || t('devices.theComputer'),
        workspaceId: result.device.workspaceId,
      });
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
          {request.deviceName || t('devices.unnamedComputer')}
        </span>
        <span className="text-xs text-slate-400">
          {formatNodes(t('devices.asked'), { when: <When iso={request.createdAt} /> })} ·{' '}
          {expiryText(request.expiresAt)}
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
              {t('devices.workspace')}
              <select
                className={`${INPUT} mt-1`}
                value={chosen}
                onChange={(event) => setWorkspaceId(event.target.value)}
                required
              >
                <option value="">{t('devices.chooseWorkspace')}</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              {t('devices.nameOptional')}
              <input
                className={`${INPUT} mt-1`}
                value={name}
                maxLength={80}
                placeholder={request.deviceName || t('devices.asProposed')}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <fieldset className="space-y-2 text-sm text-slate-300">
            <legend className="mb-1">{t('devices.mergeLegend')}</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`merge-${request.code}`}
                className="mt-1"
                checked={allowMerge === true}
                onChange={() => setAllowMerge(true)}
              />
              <span>
                <span className="text-slate-100">{t('devices.allowMerge')}</span>
                <span className="block text-xs text-slate-400">{t('devices.allowMergeHint')}</span>
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
                <span className="text-slate-100">{t('devices.noMerge')}</span>
                <span className="block text-xs text-slate-400">{t('devices.noMergeHint')}</span>
              </span>
            </label>
          </fieldset>
          {allowMerge === false && props.churchLibraryEmpty && (
            <Notice tone="warning">
              {t('devices.noMergeWarning')}{' '}
              {chosen && !workspaceHasContent
                ? t('devices.emptyLibraryNoContent')
                : t('devices.emptyLibrary')}
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
              {t('devices.approve')}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={approve.busy}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" small onClick={() => setOpen(true)}>
            {t('devices.approveMore')}
          </Button>
          <Button variant="danger" small onClick={() => setRefusing(true)}>
            {t('devices.refuse')}
          </Button>
        </div>
      )}
      {refusing && (
        <Confirm
          title={t('devices.refuseTitle', {
            device: request.deviceName || t('devices.thisComputer'),
          })}
          confirmLabel={t('devices.refuse')}
          danger
          onCancel={() => setRefusing(false)}
          onConfirm={async () => {
            await api.refusePairing(request.code);
            setRefusing(false);
            props.onDone({
              code: request.code,
              outcome: 'refused',
              deviceName: request.deviceName || t('devices.unnamedComputer'),
            });
          }}
        >
          <p>{formatNodes(t('devices.refuseText'), { code: <strong>{request.code}</strong> })}</p>
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
          label={t('devices.name')}
          value={name}
          onChange={setName}
          placeholder={t('devices.name')}
          submitLabel={t('common.save')}
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
            {device.name || t('devices.unnamed')}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {device.connected && !revoked && <Badge tone="live">{t('devices.connectedNow')}</Badge>}
            {revoked && <Badge tone="warn">{t('devices.revoked')}</Badge>}
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
                  {t('devices.rename')}
                </Button>
                <Button small variant="ghost" onClick={() => setRevoking(true)}>
                  {t('devices.revoke')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
        {showWorkspace && (
          <span>
            {formatNodes(t('devices.inWorkspace'), {
              workspace: <span className="text-slate-200">{device.workspaceName || '—'}</span>,
            })}
          </span>
        )}
        <span>
          {device.enrolledBy === 'code'
            ? t('devices.joinedWithCode')
            : device.approvedBy
              ? t('devices.pairedBy', { name: device.approvedBy })
              : t('devices.paired')}{' '}
          <When iso={device.createdAt} />
        </span>
        {revoked ? (
          <span>
            {formatNodes(t('devices.revokedWhen'), { when: <When iso={device.revokedAt!} /> })}
          </span>
        ) : (
          <span>
            {formatNodes(t('devices.lastSeen'), { when: <When iso={device.lastSeenAt} /> })}
          </span>
        )}
      </p>
      {revoking && (
        <Confirm
          title={t('devices.revokeTitle', { device: device.name || t('devices.thisDevice') })}
          confirmLabel={t('devices.revoke')}
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
            {formatNodes(t('devices.revokeText'), {
              workspace: <strong>{device.workspaceName}</strong>,
            })}
          </p>
        </Confirm>
      )}
    </li>
  );
}

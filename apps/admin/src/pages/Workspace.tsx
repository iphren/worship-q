import {
  itemBadge,
  LIBRARY_TYPES,
  OBS_REPORT_EVERY_MS,
  outputElapsed,
  type AdminLibraryPlan,
  type AdminLiveView,
  type AdminObsView,
  type AdminWorkspace,
  type LibraryType,
  type SnapshotItem,
} from '@worship-q/protocol';
import { ControlIcon, ItemBadgeMark } from '@worship-q/ui';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../api';
import { AdminListen } from '../audio';
import {
  connectionLabel,
  roleLabel,
  expiryText,
  formatDate,
  formatAge,
  formatDateTime,
  isPast,
  libraryTypeLabel,
  libraryTypeNoun,
  libraryTypeList,
  managedLabel,
  obsStatusLabel,
  obsOutputText,
  onScreen,
  orderDevices,
  routePath,
} from '../format';
import { useSession } from '../session';
import {
  Badge,
  Button,
  Card,
  CodeReveal,
  Confirm,
  Empty,
  ErrorText,
  InlineForm,
  Link,
  Notice,
  PageTitle,
  SectionTitle,
  Spinner,
  Switch,
  When,
} from '../ui';
import { SlideshowPreview, SubtitleBar } from '../preview';
import { useAction, useLoad } from '../useLoad';
import { DEVICES_POLL_MS, DeviceRow } from './Devices';
import { RunSheetsSection } from './RunSheets';
import { formatNodes, t, tp, type MessageKey } from '@worship-q/i18n/admin';

export function WorkspacePage({ id }: { id: string }) {
  // There is no route for one workspace, so the list is loaded and the one picked out.
  const list = useLoad(() => api.workspaces(), []);
  const workspace = list.data?.workspaces.find((w) => w.id === id) ?? null;
  const replace = (next: AdminWorkspace) =>
    list.setData((d) => ({ workspaces: d.workspaces.map((w) => (w.id === next.id ? next : w)) }));

  if (!list.data) {
    return (
      <div className="space-y-3">
        <ErrorText error={list.error} />
        {!list.error && (
          <p className="flex items-center gap-2 text-slate-400">
            <Spinner /> {t('common.loading')}
          </p>
        )}
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">{t('workspace.notFound')}</h1>
        <p className="text-slate-400">{t('workspace.notFoundText')}</p>
        <Link to={routePath({ page: 'workspaces' })} className="text-sky-400 hover:underline">
          {t('workspace.back')}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Link
        to={routePath({ page: 'workspaces' })}
        className="text-sm text-slate-400 hover:text-white"
      >
        ‹ {t('nav.workspaces')}
      </Link>
      <Header workspace={workspace} onChanged={replace} />
      <ErrorText error={list.error} />
      <LiveSection id={id} />
      <AudioSection id={id} />
      <ObsSection id={id} />
      <RunSheetsSection id={id} />
      <DevicesSection id={id} onRevoked={list.reload} />
      <CodeSection workspace={workspace} onChanged={replace} />
      <LibrarySection workspace={workspace} onChanged={replace} />
    </div>
  );
}

function Header(props: { workspace: AdminWorkspace; onChanged(next: AdminWorkspace): void }) {
  const { workspace } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const rename = useAction();
  async function submit() {
    const result = await rename.run(() => api.updateWorkspace(workspace.id, { name: name.trim() }));
    if (!result) return;
    props.onChanged(result.workspace);
    setEditing(false);
  }
  return (
    <div>
      {editing ? (
        <InlineForm
          label={t('workspace.name')}
          value={name}
          onChange={setName}
          placeholder={t('workspace.name')}
          submitLabel={t('common.save')}
          busy={rename.busy}
          error={rename.error}
          autoFocus
          onSubmit={() => void submit()}
          onCancel={() => {
            setEditing(false);
            rename.clear();
          }}
        />
      ) : (
        <PageTitle
          aside={
            <Button
              small
              onClick={() => {
                setName(workspace.name);
                setEditing(true);
              }}
            >
              {t('devices.rename')}
            </Button>
          }
        >
          {workspace.name}
          {workspace.live && <Badge tone="live">{t('common.live')}</Badge>}
        </PageTitle>
      )}
      <p className="text-sm text-slate-400">
        {tp('workspaces.devices', workspace.devices)} ·{' '}
        {formatNodes(t('workspace.created'), { when: <When iso={workspace.createdAt} /> })}
        {workspace.contentId === null && ` · ${t('workspace.noContent')}`}
      </p>
    </div>
  );
}

// ── Devices (D29) ────────────────────────────────────────────────────────────

/** This workspace's devices, as on the Devices page; revoked ones are left out like there. */
function DevicesSection(props: { id: string; onRevoked(): void }) {
  const list = useLoad(() => api.devices(), [], DEVICES_POLL_MS);
  const [revokedHere, setRevokedHere] = useState<ReadonlySet<string>>(new Set());
  const devices = orderDevices(
    (list.data?.devices ?? []).filter(
      (d) => d.workspaceId === props.id && (d.revokedAt === null || revokedHere.has(d.id)),
    ),
  );
  return (
    <Card>
      <SectionTitle
        aside={
          <Link
            to={routePath({ page: 'devices', pairCode: null })}
            className="text-sm text-sky-400 hover:underline"
          >
            {t('workspace.allDevices')}
          </Link>
        }
      >
        {t('nav.devices')}
      </SectionTitle>
      <ErrorText error={list.error} className="mb-2" />
      {!list.data && !list.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> {t('common.loading')}
        </p>
      )}
      {list.data && devices.length === 0 && <Empty>{t('workspace.noDevices')}</Empty>}
      <ul className="space-y-2">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            showWorkspace={false}
            onChanged={(next) => {
              if (next.revokedAt !== null) {
                setRevokedHere((ids) => new Set(ids).add(next.id));
                props.onRevoked();
              }
              list.setData((d) => ({
                ...d,
                devices: d.devices.map((x) => (x.id === next.id ? next : x)),
              }));
            }}
          />
        ))}
      </ul>
    </Card>
  );
}

// ── Connection code (D30) ────────────────────────────────────────────────────

function CodeSection(props: { workspace: AdminWorkspace; onChanged(next: AdminWorkspace): void }) {
  const { workspace } = props;
  const me = useSession();
  const toggle = useAction();
  const [confirmNew, setConfirmNew] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function setEnabled(codesEnabled: boolean) {
    const result = await toggle.run(() => api.updateWorkspace(workspace.id, { codesEnabled }));
    if (result) props.onChanged(result.workspace);
  }

  return (
    <Card>
      <SectionTitle
        aside={
          <Switch
            label={t('workspace.codeWorks')}
            checked={workspace.codesEnabled}
            disabled={toggle.busy}
            onChange={(on) => void setEnabled(on)}
          />
        }
      >
        {t('code.setting')}
      </SectionTitle>
      <div className="space-y-3 text-sm text-slate-300">
        {me.hasAdministrators ? (
          <p>
            {formatNodes(t('workspace.codeState'), {
              state: <strong>{t(workspace.codesEnabled ? 'settings.on' : 'settings.off')}</strong>,
            })}
          </p>
        ) : (
          <p>{t('workspace.codeAlways')}</p>
        )}
        <ErrorText error={toggle.error} />
        {code && (
          <CodeReveal code={code} workspaceName={workspace.name} onClose={() => setCode(null)} />
        )}
        <Button small onClick={() => setConfirmNew(true)}>
          {t('workspace.newCode')}
        </Button>
      </div>
      {confirmNew && (
        <Confirm
          title={t('workspace.newCodeTitle')}
          confirmLabel={t('workspace.newCode')}
          onCancel={() => setConfirmNew(false)}
          onConfirm={async () => {
            const result = await api.newCode(workspace.id);
            setCode(result.code);
            setConfirmNew(false);
          }}
        >
          <p>{t('workspace.newCodeText')}</p>
        </Confirm>
      )}
    </Card>
  );
}

// ── Manage Church Library (D36) ──────────────────────────────────────────────

function LibrarySection(props: {
  workspace: AdminWorkspace;
  onChanged(next: AdminWorkspace): void;
}) {
  const { workspace } = props;
  const [turning, setTurning] = useState<{ type: LibraryType; on: boolean } | null>(null);
  const [plan, setPlan] = useState<AdminLibraryPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ type: LibraryType; files: number } | null>(null);
  const managed = workspace.libraryTypes;

  function begin(type: LibraryType, on: boolean) {
    setMoved(null);
    setTurning({ type, on });
    setPlan(null);
    setPlanError(null);
    if (on) {
      api
        .libraryPlan(workspace.id, [type])
        .then(setPlan, (cause: unknown) =>
          setPlanError(cause instanceof Error ? cause.message : t('workspace.planFailed')),
        );
    }
  }

  async function confirm(type: LibraryType, on: boolean) {
    const next = on ? [...managed, type] : managed.filter((t) => t !== type);
    const result = await api.setLibraryTypes(workspace.id, next);
    props.onChanged(result.workspace);
    setMoved(on ? { type, files: result.moved } : null);
    setTurning(null);
  }

  const noun = turning ? libraryTypeNoun(turning.type) : '';
  return (
    <Card>
      <SectionTitle>{t('workspace.manage')}</SectionTitle>
      <div className="space-y-3 text-sm text-slate-300">
        {managed.length > 0 ? (
          <p>
            {formatNodes(t('workspace.manages'), {
              manages: (
                <strong>{t('workspace.managesWhat', { what: managedLabel(managed) })}</strong>
              ),
              types: libraryTypeList(managed),
            })}
            {managed.length < LIBRARY_TYPES.length && ` ${t('workspace.restOwn')}`}
          </p>
        ) : (
          <p>{t('workspace.ownLibrary')}</p>
        )}
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {LIBRARY_TYPES.map((type) => (
            <li key={type} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-slate-100">{libraryTypeLabel(type)}</span>
              <Switch
                label={t('workspace.manageType', { noun: libraryTypeNoun(type) })}
                checked={managed.includes(type)}
                onChange={(on) => begin(type, on)}
              />
            </li>
          ))}
        </ul>
        {moved !== null && (
          <Notice tone="success" onClose={() => setMoved(null)}>
            {t('workspace.nowManages', { noun: libraryTypeNoun(moved.type) })}{' '}
            {tp('workspace.filesMoved', moved.files)}
          </Notice>
        )}
      </div>
      {turning?.on && (
        <Confirm
          title={t('workspace.manageTitle', { noun })}
          confirmLabel={t('workspace.turnOn')}
          ready={plan !== null}
          onCancel={() => setTurning(null)}
          onConfirm={() => confirm(turning.type, true)}
        >
          <p>
            {formatNodes(t('workspace.manageText'), {
              noun,
              workspace: <strong>{workspace.name}</strong>,
            })}
          </p>
          <ErrorText error={planError} />
          {!plan && !planError && (
            <p className="flex items-center gap-2 text-slate-400">
              <Spinner /> {t('workspace.working')}
            </p>
          )}
          {plan && <PlanView plan={plan} />}
        </Confirm>
      )}
      {turning && !turning.on && (
        <Confirm
          title={t('workspace.stopTitle', { noun })}
          confirmLabel={t('workspace.turnOff')}
          onCancel={() => setTurning(null)}
          onConfirm={() => confirm(turning.type, false)}
        >
          <p>
            {formatNodes(t('workspace.stopText'), {
              noun,
              workspace: <strong>{workspace.name}</strong>,
            })}
          </p>
        </Confirm>
      )}
    </Card>
  );
}

/** The plan grouped as D36 asks, so the administrator sees every effect before confirming. */
function PlanView({ plan }: { plan: AdminLibraryPlan }) {
  const promoted = plan.overrides.filter((o) => !o.usesChurchVersion);
  const dropped = plan.overrides.filter((o) => o.usesChurchVersion);
  const empty =
    plan.songs.length +
      plan.slides.length +
      plan.websites.length +
      plan.backgrounds.length +
      plan.overrides.length +
      plan.hidden.length ===
    0;
  if (empty) {
    return <p className="text-slate-400">{t('workspace.planNothing')}</p>;
  }
  return (
    <div className="space-y-3">
      <PlanGroup title={t('workspace.plan.songs')} items={plan.songs} />
      <PlanGroup title={t('workspace.plan.slides')} items={plan.slides} />
      <PlanGroup title={t('workspace.plan.websites')} items={plan.websites} />
      <PlanGroup title={t('workspace.plan.backgrounds')} items={plan.backgrounds} />
      {promoted.length > 0 && (
        <PlanGroup
          title={t('workspace.plan.promoted')}
          items={promoted.map((o) => (
            <>
              {o.title}
              {o.churchChangedSince && (
                <Badge tone="warn">{t('workspace.plan.churchChanged')}</Badge>
              )}
            </>
          ))}
        />
      )}
      {dropped.length > 0 && (
        <PlanGroup
          title={t('workspace.plan.dropped')}
          hint={t('workspace.plan.droppedHint')}
          items={dropped.map((o) => o.title)}
        />
      )}
      <PlanGroup
        title={t('workspace.plan.hidden')}
        hint={t('workspace.plan.hiddenHint')}
        items={plan.hidden}
      />
    </div>
  );
}

function PlanGroup(props: { title: string; hint?: string; items: ReactNode[] }) {
  if (props.items.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold text-slate-100">
        {props.title} <span className="font-normal text-slate-400">({props.items.length})</span>
      </h3>
      {props.hint && <p className="text-xs text-slate-400">{props.hint}</p>}
      <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-slate-200">
        {props.items.map((item, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Live now (D38) ───────────────────────────────────────────────────────────

const LIVE_POLL_MS = 5000;

function LiveSection({ id }: { id: string }) {
  const live = useLoad(() => api.live(id), [id], LIVE_POLL_MS);
  const view: AdminLiveView | null = live.data;
  return (
    <Card>
      <SectionTitle
        aside={
          view?.live ? (
            <Badge tone="live">{t('runSheets.liveNow')}</Badge>
          ) : view ? (
            <Badge>{t('workspace.notPresenting')}</Badge>
          ) : null
        }
      >
        {t('workspace.presentation')}
      </SectionTitle>
      <ErrorText error={live.error} className="mb-2" />
      {!view && !live.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> {t('workspace.checking')}
        </p>
      )}
      {view && !view.live && <p className="text-sm text-slate-400">{t('workspace.noneLive')}</p>}
      {view?.live && <LiveView view={view} workspaceId={id} />}
    </Card>
  );
}

function LiveView(props: { view: Extract<AdminLiveView, { live: true }>; workspaceId: string }) {
  const { view, workspaceId } = props;
  const { snapshot, coordinator } = view;
  const screen = onScreen(snapshot);
  const expired = isPast(view.expiresAt);
  return (
    <div className="divide-y divide-slate-800 text-sm *:py-6 *:first:pt-0 *:last:pb-0">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Fact label={t('role.coordinator')}>
          {coordinator.name ?? t('devices.unnamedComputer')}{' '}
          {coordinator.connected ? (
            <Badge tone="live">{t('workspace.connected')}</Badge>
          ) : (
            <span className="text-slate-400">
              · {formatNodes(t('workspace.lastHeard'), { when: <When iso={view.updatedAt} /> })}
            </span>
          )}
        </Fact>
        <Fact label={t('workspace.runSheet')}>{formatDate(snapshot.date)}</Fact>
        <Fact label={t('workspace.started')}>
          <When iso={snapshot.state.startedAt} />
        </Fact>
        <Fact label={expired ? t('workspace.expiry') : t('workspace.withoutComputer')}>
          <span title={formatDateTime(view.expiresAt)} className={expired ? 'text-amber-300' : ''}>
            {expiryText(view.expiresAt)}
          </span>
        </Fact>
      </dl>

      {/* Alone in a column the previews take the full width; beside the run sheet, when the
          card is wide enough for both, they take a share of it that grows to a cap. */}
      <div className="@container">
        <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-start">
          <div className="w-full shrink-0 space-y-4 @2xl:w-[45%] @2xl:max-w-xl">
            <div>
              <h3 className="mb-1 flex flex-wrap items-center gap-2 font-semibold text-slate-100">
                {t('workspace.onScreen')}
                {screen.title && (
                  <span className="min-w-0 truncate font-normal text-slate-300">
                    · {screen.title}
                  </span>
                )}
                {screen.blank && <Badge tone="warn">{t('workspace.blank')}</Badge>}
                {screen.pieceMissing && <Badge tone="warn">{t('workspace.slideMissing')}</Badge>}
              </h3>
              <SlideshowPreview view={view} workspaceId={workspaceId} />
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-slate-100">{t('workspace.subtitle')}</h3>
              <SubtitleBar view={view} workspaceId={workspaceId} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 font-semibold text-slate-100">{t('workspace.items')}</h3>
            {snapshot.items.length === 0 ? (
              <p className="text-slate-400">{t('workspace.noItems')}</p>
            ) : (
              <ol className="space-y-1">
                {snapshot.items.map((item, index) => {
                  const current = snapshot.presented?.itemId === item.itemId;
                  return (
                    <li
                      key={item.itemId}
                      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-3 py-1.5 ${
                        current ? 'bg-emerald-900/50 text-white' : 'text-slate-300'
                      }`}
                    >
                      <span className="w-5 shrink-0 text-right text-xs text-slate-500">
                        {index + 1}
                      </span>
                      <span className="flex min-w-40 flex-1 items-center gap-2">
                        <ItemMark item={item} />
                        <span className="min-w-0 truncate">
                          {item.title || t('common.untitled')}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {item.removed && <Badge tone="warn">{t('runSheets.removed')}</Badge>}
                        {current && <Badge tone="live">{t('workspace.onScreen')}</Badge>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1 font-semibold text-slate-100">{t('workspace.connectedDevices')}</h3>
        {snapshot.devices.length === 0 ? (
          <p className="text-slate-400">{t('workspace.noFollowers')}</p>
        ) : (
          <ul className="space-y-1">
            {snapshot.devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-slate-900 px-3 py-1.5"
              >
                <span className="min-w-40 flex-1 truncate font-medium text-slate-100">
                  {device.name || t('devices.unnamed')}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  <span className="text-slate-400">{roleLabel(device.role)}</span>
                  <span className="text-slate-500">{connectionLabel(device.connection)}</span>
                </span>
                <span className="text-xs text-slate-500">
                  <When iso={device.lastSeenAt} prefix={t('workspace.seen')} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** An item's badge, as the desktop marks it; nothing for an ordinary song. */
function ItemMark(props: { item: Pick<SnapshotItem, 'kind' | 'badge'> }) {
  const badge = itemBadge(props.item);
  return badge ? <ItemBadgeMark badge={badge} /> : null;
}

// ── OBS ──────────────────────────────────────────────────────────────────────

/** A report older than this missed two heartbeats: the OBS computer has gone quiet. */
const OBS_STALE_MS = OBS_REPORT_EVERY_MS * 2.5;

const OBS_OUTPUTS = [
  { kind: 'stream', label: 'obs.stream' },
  { kind: 'record', label: 'obs.record' },
  { kind: 'virtualCam', label: 'obs.camera' },
] as const;

/** The workspace's OBS state, as its OBS computer last reported it. Hidden when none has. */
const LISTEN_TEXT: Record<string, MessageKey> = {
  off: 'listen.off',
  connecting: 'listen.connecting',
  playing: 'listen.playing',
  waiting: 'listen.waiting',
  reconnecting: 'obs.reconnecting',
  full: 'listen.full',
};

/**
 * Live audio (A14, M5.8): under the presentation, only while the broadcaster reports a
 * broadcast and is connected to this server. Nothing plays before **Listen** is pressed.
 */
function AudioSection({ id }: { id: string }) {
  const loaded = useLoad(() => api.audio(id), [id], LIVE_POLL_MS);
  const audio = loaded.data?.audio ?? null;
  const [listen] = useState(() => new AdminListen(id));
  useEffect(() => () => listen.dispose(), [listen]);
  const state = useSyncExternalStore(listen.subscribe, () => listen.state);
  const key = audio ? `${audio.ownerName}|${audio.status}|${audio.connected}` : '';
  useEffect(() => listen.follow(audio), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = state.status.kind !== 'off';
  if (!audio && !on) return null;
  const status =
    state.status.kind === 'unreachable'
      ? t(state.status.relay ? 'listen.unreachableRelay' : 'listen.unreachable')
      : t(LISTEN_TEXT[state.status.kind] ?? 'listen.off');
  const delay =
    on && state.delay
      ? `${state.delay.delayMs === null ? '–' : t('listen.delay', { ms: state.delay.delayMs })}${
          state.delay.path
            ? ` · ${t(state.delay.path === 'relayed' ? 'listen.relayed' : 'listen.direct')}`
            : ''
        }`
      : null;
  return (
    <Card>
      <SectionTitle
        aside={
          audio ? (
            <Badge tone={audio.status === 'live' ? 'live' : 'warn'}>
              {audio.status === 'live'
                ? t('workspace.audioLive', { count: audio.listeners })
                : t('workspace.audioWaiting')}
            </Badge>
          ) : null
        }
      >
        {t('workspace.audio')}
      </SectionTitle>
      {audio && (
        <p className="text-sm text-slate-300">
          {t('workspace.audioFrom', { name: audio.ownerName })}
        </p>
      )}
      {audio && !audio.connected && !on && (
        <p className="text-sm text-slate-400">{t('workspace.audioNotConnected')}</p>
      )}
      {audio?.relayDown && (
        <p className="mt-1 text-sm text-amber-300">{t('workspace.audioRelayDown')}</p>
      )}
      {(audio?.connected || on) && (
        <div className="mt-2 flex items-center gap-3">
          <Button
            title={t(on ? 'listen.stop' : 'listen.title')}
            aria-label={t(on ? 'listen.stop' : 'listen.title')}
            onClick={() => (on ? listen.stop() : listen.start())}
          >
            <ControlIcon name={on ? 'stop' : 'listen'} className="h-5 w-5" />
          </Button>
          {on && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      )}
      {delay && <p className="mt-1 text-xs text-slate-500">{delay}</p>}
    </Card>
  );
}

function ObsSection({ id }: { id: string }) {
  const loaded = useLoad(() => api.obs(id), [id], LIVE_POLL_MS);
  const obs = loaded.data?.obs ?? null;
  if (!obs) return null;
  return (
    <Card>
      <SectionTitle
        aside={
          obs.state.active ? (
            <Badge tone={obs.state.status === 'connected' ? 'live' : 'warn'}>
              {obsStatusLabel(obs.state.status)}
            </Badge>
          ) : (
            <Badge>{t('obs.off')}</Badge>
          )
        }
      >
        OBS
      </SectionTitle>
      <ErrorText error={loaded.error} className="mb-2" />
      <ObsView obs={obs} />
    </Card>
  );
}

function ObsView({ obs }: { obs: NonNullable<AdminObsView['obs']> }) {
  const { state, owner } = obs;
  // When the report arrived, on this browser's clock; the timers count on from there.
  const [arrived, setArrived] = useState(() => Date.now() - obs.ageMs);
  useEffect(() => setArrived(Date.now() - obs.ageMs), [obs]);
  const now = useNow(1000);
  const stale = now - arrived > OBS_STALE_MS;
  const computer = (
    <Fact label={t('workspace.obsComputer')}>
      {owner.name ?? state.ownerName ?? t('devices.unnamedComputer')}{' '}
      {owner.connected ? (
        <Badge tone="live">{t('workspace.connected')}</Badge>
      ) : (
        <span className="text-slate-400">{t('workspace.notConnected')}</span>
      )}
    </Fact>
  );
  if (!state.active) {
    return (
      <div className="text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{computer}</dl>
        <p className="mt-3 text-slate-400">
          {formatNodes(t('workspace.obsOff'), { when: <When iso={obs.receivedAt} /> })}
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-800 text-sm *:py-6 *:first:pt-0 *:last:pb-0">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {computer}
        <Fact label={t('workspace.onProgram')}>{state.currentScene ?? '—'}</Fact>
        <Fact label={t('workspace.lastReport')}>
          <span className={stale ? 'text-amber-300' : ''}>
            <When iso={obs.receivedAt} />
            {stale && ` · ${t('workspace.obsStale')}`}
          </span>
        </Fact>
      </dl>

      {/* Alone in a column the monitor and outputs take the full width; beside the scenes,
          when the card is wide enough for both, they take a share of it that grows to a cap,
          as the presentation's previews do. */}
      <div className="@container">
        <div className="flex flex-col gap-6 @2xl:flex-row @2xl:items-start">
          <div className="w-full shrink-0 space-y-4 @2xl:w-[45%] @2xl:max-w-xl">
            {obs.snapshot && (
              <figure>
                <img
                  src={obs.snapshot.image}
                  alt={t('workspace.obsProgram', {
                    scene: state.currentScene ?? t('workspace.scene'),
                  })}
                  className={`aspect-video w-full rounded-lg bg-black object-contain ${stale ? 'opacity-60' : ''}`}
                />
                <figcaption className="pt-1 text-xs text-slate-400">
                  {t('workspace.obsTaken', {
                    age: formatAge(obs.snapshot.ageMs + (now - arrived - obs.ageMs)),
                    seconds: OBS_REPORT_EVERY_MS / 1000,
                  })}
                </figcaption>
              </figure>
            )}
            <div>
              <h3 className="mb-1 font-semibold text-slate-100">{t('workspace.outputs')}</h3>
              <ul className={`space-y-1 ${stale ? 'opacity-60' : ''}`}>
                {OBS_OUTPUTS.map(({ kind, label }) => {
                  const output = state[kind];
                  const elapsed = stale ? null : outputElapsed(output, arrived, now);
                  return (
                    <li
                      key={kind}
                      className="flex items-center gap-3 rounded-lg bg-slate-900 px-3 py-1.5"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${output.active ? 'bg-rose-500' : 'bg-slate-600'}`}
                      />
                      <span className="flex-1 font-medium text-slate-100">{t(label)}</span>
                      <span className="text-slate-300 tabular-nums">
                        {obsOutputText(output, elapsed)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 font-semibold text-slate-100">{t('workspace.scenes')}</h3>
            {state.scenes.length === 0 ? (
              <p className="text-slate-400">{t('workspace.scenesLater')}</p>
            ) : (
              <ol className="space-y-1">
                {state.scenes.map((scene) => {
                  const live = scene === state.currentScene;
                  return (
                    <li
                      key={scene}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                        live ? 'bg-emerald-900/50 text-white' : 'text-slate-300'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{scene}</span>
                      {live && <Badge tone="live">{t('common.live')}</Badge>}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{props.label}</dt>
      <dd className="text-slate-200">{props.children}</dd>
    </div>
  );
}

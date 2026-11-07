import {
  LIBRARY_TYPES,
  OBS_REPORT_EVERY_MS,
  outputElapsed,
  type AdminLibraryPlan,
  type AdminLiveView,
  type AdminObsView,
  type AdminWorkspace,
  type LibraryType,
} from '@worship-q/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import {
  CONNECTION_LABEL,
  ROLE_LABEL,
  expiryText,
  formatDate,
  formatAge,
  formatDateTime,
  isPast,
  LIBRARY_TYPE_LABELS,
  LIBRARY_TYPE_NOUNS,
  libraryTypeList,
  managedLabel,
  OBS_STATUS_LABEL,
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
            <Spinner /> Loading…
          </p>
        )}
      </div>
    );
  }
  if (!workspace) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">Workspace not found</h1>
        <p className="text-slate-400">There is no workspace with this address.</p>
        <Link to={routePath({ page: 'workspaces' })} className="text-sky-400 hover:underline">
          Back to Workspaces
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
        ‹ Workspaces
      </Link>
      <Header workspace={workspace} onChanged={replace} />
      <ErrorText error={list.error} />
      <LiveSection id={id} />
      <ObsSection id={id} />
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
          label="Workspace name"
          value={name}
          onChange={setName}
          placeholder="Workspace name"
          submitLabel="Save"
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
              Rename
            </Button>
          }
        >
          {workspace.name}
          {workspace.live && <Badge tone="live">Live</Badge>}
        </PageTitle>
      )}
      <p className="text-sm text-slate-400">
        {workspace.devices === 1 ? '1 device' : `${workspace.devices} devices`} · Created{' '}
        <When iso={workspace.createdAt} />
        {workspace.contentId === null && ' · No content uploaded yet'}
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
            All devices
          </Link>
        }
      >
        Devices
      </SectionTitle>
      <ErrorText error={list.error} className="mb-2" />
      {!list.data && !list.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Loading…
        </p>
      )}
      {list.data && devices.length === 0 && <Empty>No device has joined this workspace.</Empty>}
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
            label="Connection code works"
            checked={workspace.codesEnabled}
            disabled={toggle.busy}
            onChange={(on) => void setEnabled(on)}
          />
        }
      >
        Connection code
      </SectionTitle>
      <div className="space-y-3 text-sm text-slate-300">
        {me.hasAdministrators ? (
          <p>
            The code is {workspace.codesEnabled ? <strong>on</strong> : <strong>off</strong>}.
            Because this instance has administrators, codes are off unless turned on here: a new
            computer normally pairs instead, and an administrator approves it on the Devices page.
            Turn the code on for a while when a computer must join with it, and off again
            afterwards.
          </p>
        ) : (
          <p>Computers join this workspace with its connection code.</p>
        )}
        <ErrorText error={toggle.error} />
        {code && (
          <CodeReveal code={code} workspaceName={workspace.name} onClose={() => setCode(null)} />
        )}
        <Button small onClick={() => setConfirmNew(true)}>
          New code
        </Button>
      </div>
      {confirmNew && (
        <Confirm
          title="Make a new connection code?"
          confirmLabel="New code"
          onCancel={() => setConfirmNew(false)}
          onConfirm={async () => {
            const result = await api.newCode(workspace.id);
            setCode(result.code);
            setConfirmNew(false);
          }}
        >
          <p>
            The current code stops working at once. Computers that already joined are not affected.
            The new code is shown once.
          </p>
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
          setPlanError(cause instanceof Error ? cause.message : 'The plan could not be loaded.'),
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

  const noun = turning ? LIBRARY_TYPE_NOUNS[turning.type] : '';
  return (
    <Card>
      <SectionTitle>Manage Church Library</SectionTitle>
      <div className="space-y-3 text-sm text-slate-300">
        {managed.length > 0 ? (
          <p>
            This workspace <strong>manages {managedLabel(managed)}</strong>: its{' '}
            {libraryTypeList(managed)} are the church's, and every workspace receives them.
            {managed.length < LIBRARY_TYPES.length && ' Everything else it has stays its own.'}
          </p>
        ) : (
          <p>
            This workspace has its own library and receives the Church Library. Turning a type on
            makes the workspace's items of that type the church's; the changes are listed for
            confirmation first.
          </p>
        )}
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {LIBRARY_TYPES.map((type) => (
            <li key={type} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-slate-100">{LIBRARY_TYPE_LABELS[type]}</span>
              <Switch
                label={`Manage the Church Library's ${LIBRARY_TYPE_NOUNS[type]}`}
                checked={managed.includes(type)}
                onChange={(on) => begin(type, on)}
              />
            </li>
          ))}
        </ul>
        {moved !== null && (
          <Notice tone="success" onClose={() => setMoved(null)}>
            This workspace now manages the Church Library's {LIBRARY_TYPE_NOUNS[moved.type]}.{' '}
            {moved.files === 1 ? '1 file was moved' : `${moved.files} files were moved`} to the
            Church Library.
          </Notice>
        )}
      </div>
      {turning?.on && (
        <Confirm
          title={`Manage the Church Library's ${noun}?`}
          confirmLabel="Turn on"
          ready={plan !== null}
          onCancel={() => setTurning(null)}
          onConfirm={() => confirm(turning.type, true)}
        >
          <p>
            The {noun} in <strong>{workspace.name}</strong> become the church's and reach every
            workspace. This is what will happen:
          </p>
          <ErrorText error={planError} />
          {!plan && !planError && (
            <p className="flex items-center gap-2 text-slate-400">
              <Spinner /> Working out the changes…
            </p>
          )}
          {plan && <PlanView plan={plan} />}
        </Confirm>
      )}
      {turning && !turning.on && (
        <Confirm
          title={`Stop managing the Church Library's ${noun}?`}
          confirmLabel="Turn off"
          onCancel={() => setTurning(null)}
          onConfirm={() => confirm(turning.type, false)}
        >
          <p>
            <strong>{workspace.name}</strong> stops managing the Church Library's {noun}. The {noun}{' '}
            it put there stay the church's; from now on the workspace receives them like any other,
            and its new {noun} stay its own.
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
    return (
      <p className="text-slate-400">Nothing changes: the workspace has no content of its own.</p>
    );
  }
  return (
    <div className="space-y-3">
      <PlanGroup title="Songs that become the church's" items={plan.songs} />
      <PlanGroup title="Slides that become the church's" items={plan.slides} />
      <PlanGroup title="Websites that become the church's" items={plan.websites} />
      <PlanGroup title="Backgrounds that become the church's" items={plan.backgrounds} />
      {promoted.length > 0 && (
        <PlanGroup
          title="Church items this workspace's version replaces, church-wide"
          items={promoted.map((o) => (
            <>
              {o.title}
              {o.churchChangedSince && <Badge tone="warn">the church's changed since</Badge>}
            </>
          ))}
        />
      )}
      {dropped.length > 0 && (
        <PlanGroup
          title="Versions dropped, the church's stands"
          hint="This workspace chose the church's version of these, so its own version is let go, not promoted."
          items={dropped.map((o) => o.title)}
        />
      )}
      <PlanGroup
        title="Hidden church items that reappear"
        hint="The workspace had deleted these from its view; they come back for it."
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
            <Badge tone="live">Live now</Badge>
          ) : view ? (
            <Badge>Not presenting</Badge>
          ) : null
        }
      >
        Presentation
      </SectionTitle>
      <ErrorText error={live.error} className="mb-2" />
      {!view && !live.error && (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Checking…
        </p>
      )}
      {view && !view.live && (
        <p className="text-sm text-slate-400">
          No computer of this workspace is presenting right now. This page checks every few seconds.
        </p>
      )}
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
        <Fact label="Presenting computer">
          {coordinator.name ?? 'Unnamed computer'}{' '}
          {coordinator.connected ? (
            <Badge tone="live">Connected</Badge>
          ) : (
            <span className="text-slate-400">
              · not connected, last heard <When iso={view.updatedAt} />
            </span>
          )}
        </Fact>
        <Fact label="Run sheet">{formatDate(snapshot.date)}</Fact>
        <Fact label="Started">
          <When iso={snapshot.state.startedAt} />
        </Fact>
        <Fact label={expired ? 'Expiry' : 'Without a computer connected'}>
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
                On screen
                {screen.title && (
                  <span className="min-w-0 truncate font-normal text-slate-300">
                    · {screen.title}
                  </span>
                )}
                {screen.blank && <Badge tone="warn">Blank</Badge>}
                {screen.pieceMissing && <Badge tone="warn">Slide not in the snapshot</Badge>}
              </h3>
              <SlideshowPreview view={view} workspaceId={workspaceId} />
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-slate-100">Subtitle overlay</h3>
              <SubtitleBar view={view} workspaceId={workspaceId} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 font-semibold text-slate-100">Run sheet items</h3>
            {snapshot.items.length === 0 ? (
              <p className="text-slate-400">The run sheet has no items.</p>
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
                      <span className="min-w-40 flex-1 truncate">{item.title || 'Untitled'}</span>
                      <span className="flex flex-wrap gap-1">
                        {item.kind !== 'lyrics' && (
                          <Badge>{item.kind === 'deck' ? 'Slides' : 'Website'}</Badge>
                        )}
                        {item.removed && <Badge tone="warn">Removed from library</Badge>}
                        {current && <Badge tone="live">On screen</Badge>}
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
        <h3 className="mb-1 font-semibold text-slate-100">Connected devices</h3>
        {snapshot.devices.length === 0 ? (
          <p className="text-slate-400">No device is following the presentation.</p>
        ) : (
          <ul className="space-y-1">
            {snapshot.devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-slate-900 px-3 py-1.5"
              >
                <span className="min-w-40 flex-1 truncate font-medium text-slate-100">
                  {device.name || 'Unnamed'}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  <span className="text-slate-400">{ROLE_LABEL[device.role]}</span>
                  <span className="text-slate-500">{CONNECTION_LABEL[device.connection]}</span>
                </span>
                <span className="text-xs text-slate-500">
                  <When iso={device.lastSeenAt} prefix="seen" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── OBS ──────────────────────────────────────────────────────────────────────

/** A report older than this missed two heartbeats: the OBS computer has gone quiet. */
const OBS_STALE_MS = OBS_REPORT_EVERY_MS * 2.5;

const OBS_OUTPUTS = [
  { kind: 'stream', label: 'Stream' },
  { kind: 'record', label: 'Record' },
  { kind: 'virtualCam', label: 'Camera' },
] as const;

/** The workspace's OBS state, as its OBS computer last reported it. Hidden when none has. */
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
              {OBS_STATUS_LABEL[obs.state.status]}
            </Badge>
          ) : (
            <Badge>Off</Badge>
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
    <Fact label="OBS computer">
      {owner.name ?? state.ownerName ?? 'Unnamed computer'}{' '}
      {owner.connected ? (
        <Badge tone="live">Connected</Badge>
      ) : (
        <span className="text-slate-400">· not connected</span>
      )}
    </Fact>
  );
  if (!state.active) {
    return (
      <div className="text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{computer}</dl>
        <p className="mt-3 text-slate-400">
          OBS control is turned off on this computer. Last heard <When iso={obs.receivedAt} />.
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-800 text-sm *:py-6 *:first:pt-0 *:last:pb-0">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {computer}
        <Fact label="On program">{state.currentScene ?? '—'}</Fact>
        <Fact label="Last report">
          <span className={stale ? 'text-amber-300' : ''}>
            <When iso={obs.receivedAt} />
            {stale && ' · the OBS computer has stopped reporting'}
          </span>
        </Fact>
      </dl>

      {obs.snapshot && (
        <figure className="max-w-xl">
          <img
            src={obs.snapshot.image}
            alt={`OBS program: ${state.currentScene ?? 'scene'}`}
            className={`aspect-video w-full rounded-lg bg-black object-contain ${stale ? 'opacity-60' : ''}`}
          />
          <figcaption className="pt-1 text-xs text-slate-400">
            Program, taken {formatAge(obs.snapshot.ageMs + (now - arrived - obs.ageMs))} ago. A new
            image comes every {OBS_REPORT_EVERY_MS / 1000} seconds and soon after the scene changes.
          </figcaption>
        </figure>
      )}

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="sm:w-1/2">
          <h3 className="mb-1 font-semibold text-slate-100">Outputs</h3>
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
                  <span className="flex-1 font-medium text-slate-100">{label}</span>
                  <span className="text-slate-300 tabular-nums">
                    {obsOutputText(output, elapsed)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0 sm:w-1/2">
          <h3 className="mb-1 font-semibold text-slate-100">Scenes</h3>
          {state.scenes.length === 0 ? (
            <p className="text-slate-400">The scenes show while OBS is connected.</p>
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
                    {live && <Badge tone="live">Live</Badge>}
                  </li>
                );
              })}
            </ol>
          )}
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

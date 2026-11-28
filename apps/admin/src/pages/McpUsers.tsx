import type { AdminMcpUser, AdminWorkspace } from '@worship-q/protocol';
import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import {
  Button,
  Card,
  Confirm,
  Empty,
  ErrorText,
  INPUT,
  Notice,
  PageTitle,
  When,
  Badge,
} from '../ui';
import { useAction, useLoad } from '../useLoad';
import { formatNodes, t, tp } from '@worship-q/i18n/admin';

interface Access {
  allWorkspaces: boolean;
  workspaceIds: string[];
}

/** The workspaces a person's assistant may reach: all of them, or those ticked. */
function WorkspacePicker(props: {
  workspaces: AdminWorkspace[];
  value: Access;
  onChange(value: Access): void;
  disabled?: boolean;
}) {
  const { value, workspaces } = props;
  const toggle = (id: string, on: boolean) =>
    props.onChange({
      ...value,
      workspaceIds: on
        ? [...value.workspaceIds, id]
        : value.workspaceIds.filter((existing) => existing !== id),
    });
  return (
    <fieldset className="space-y-2" disabled={props.disabled}>
      <legend className="mb-1 text-sm font-medium text-slate-200">
        {t('mcpUsers.workspaces')}
      </legend>
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          className="h-4 w-4 accent-sky-500"
          checked={value.allWorkspaces}
          onChange={(event) => props.onChange({ ...value, allWorkspaces: event.target.checked })}
        />
        {t('mcpUsers.allWorkspaces')}
      </label>
      {!value.allWorkspaces && (
        <div className="grid gap-1 pl-6 sm:grid-cols-2">
          {workspaces.map((w) => (
            <label key={w.id} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-sky-500"
                checked={value.workspaceIds.includes(w.id)}
                onChange={(event) => toggle(w.id, event.target.checked)}
              />
              <span className="truncate">{w.name}</span>
            </label>
          ))}
        </div>
      )}
      {!value.allWorkspaces && value.workspaceIds.length === 0 && (
        <p className="text-xs text-amber-200">{t('mcpUsers.noWorkspacesChosen')}</p>
      )}
    </fieldset>
  );
}

function ConnectorAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm text-white select-all">
        {url}
      </code>
      <Button
        small
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? t('mcpUsers.copied') : t('mcpUsers.copy')}
      </Button>
    </div>
  );
}

function UserRow(props: {
  user: AdminMcpUser;
  workspaces: AdminWorkspace[];
  onChanged(user: AdminMcpUser): void;
  onRemove(): void;
}) {
  const { user, workspaces } = props;
  const [editing, setEditing] = useState<Access | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const save = useAction();
  const signOut = useAction();
  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  const reach = user.allWorkspaces
    ? t('mcpUsers.reachesAll')
    : user.workspaceIds.length === 0
      ? t('mcpUsers.reachesNone')
      : user.workspaceIds.map((id) => names.get(id) ?? id).join(t('list.separator'));

  return (
    <li className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">
            {user.name ?? user.email}{' '}
            {user.connections > 0 && (
              <Badge tone="live">{tp('mcpUsers.connections', user.connections)}</Badge>
            )}
          </p>
          {user.name && <p className="truncate text-xs text-slate-400">{user.email}</p>}
          <p className="text-sm text-slate-300">{reach}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-slate-400">
            <span>
              {user.addedBy
                ? t('admins.addedBy', { name: user.addedBy })
                : t('admins.addedAtDeployment')}{' '}
              <When iso={user.createdAt} />
            </span>
            <span>
              {user.lastSignInAt
                ? formatNodes(t('admins.lastSignIn'), { when: <When iso={user.lastSignInAt} /> })
                : t('admins.neverSignedIn')}
            </span>
            <span>
              {user.lastUsedAt
                ? formatNodes(t('mcpUsers.lastUsed'), { when: <When iso={user.lastUsedAt} /> })
                : t('mcpUsers.neverUsed')}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            small
            variant="ghost"
            onClick={() =>
              setEditing(
                editing
                  ? null
                  : { allWorkspaces: user.allWorkspaces, workspaceIds: user.workspaceIds },
              )
            }
          >
            {t('mcpUsers.edit')}
          </Button>
          {user.connections > 0 && (
            <Button
              small
              variant="ghost"
              busy={signOut.busy}
              onClick={() =>
                void signOut.run(async () => {
                  const result = await api.signOutMcpUser(user.id);
                  props.onChanged(result.mcpUser);
                  setSignedOut(true);
                })
              }
            >
              {t('mcpUsers.signOut')}
            </Button>
          )}
          <Button small variant="ghost" onClick={props.onRemove}>
            {t('common.remove')}
          </Button>
        </div>
      </div>
      <ErrorText error={signOut.error} />
      {signedOut && (
        <Notice tone="success" onClose={() => setSignedOut(false)}>
          {t('mcpUsers.signedOut')}
        </Notice>
      )}
      {editing && (
        <div className="space-y-3 border-t border-slate-800 pt-3">
          <WorkspacePicker
            workspaces={workspaces}
            value={editing}
            onChange={setEditing}
            disabled={save.busy}
          />
          <ErrorText error={save.error} />
          <div className="flex gap-2">
            <Button
              small
              variant="primary"
              busy={save.busy}
              onClick={() =>
                void save.run(async () => {
                  const result = await api.updateMcpUser(user.id, editing);
                  props.onChanged(result.mcpUser);
                  setEditing(null);
                })
              }
            >
              {t('common.save')}
            </Button>
            <Button small variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function McpUsersPage() {
  const me = useSession();
  const list = useLoad(() => api.mcpUsers(), []);
  const workspaces = useLoad(() => api.workspaces(), []);
  const add = useAction();
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<Access>({ allWorkspaces: false, workspaceIds: [] });
  const [removing, setRemoving] = useState<AdminMcpUser | null>(null);

  async function submit() {
    const result = await add.run(() => api.addMcpUser(email.trim(), access));
    if (!result) return;
    list.setData((d) => ({ mcpUsers: [...d.mcpUsers, result.mcpUser] }));
    setEmail('');
    setAccess({ allWorkspaces: false, workspaceIds: [] });
  }

  const users = list.data?.mcpUsers ?? [];
  const allWorkspaces = workspaces.data?.workspaces ?? [];
  const replace = (user: AdminMcpUser) =>
    list.setData((d) => ({ mcpUsers: d.mcpUsers.map((u) => (u.id === user.id ? user : u)) }));

  return (
    <div className="space-y-4">
      <PageTitle loading={list.loading && list.data !== null}>{t('mcpUsers.title')}</PageTitle>
      <p className="text-sm text-slate-400">{t('mcpUsers.intro')}</p>
      <ErrorText error={list.error ?? workspaces.error} />

      {me.mcp?.enabled && me.mcp.url ? (
        <Card>
          <h2 className="mb-2 font-semibold text-white">{t('mcpUsers.connectTitle')}</h2>
          <p className="mb-3 text-sm text-slate-400">{t('mcpUsers.connectHint')}</p>
          <ConnectorAddress url={me.mcp.url} />
        </Card>
      ) : (
        <Notice tone="warning">{t('mcpUsers.disabled')}</Notice>
      )}

      <Card>
        <h2 className="mb-2 font-semibold text-white">{t('mcpUsers.addTitle')}</h2>
        <p className="mb-3 text-sm text-slate-400">{t('mcpUsers.addHint')}</p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-200">
              {t('admins.email')}
            </span>
            <input
              type="email"
              className={INPUT}
              value={email}
              maxLength={200}
              placeholder={t('admins.emailPlaceholder')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <WorkspacePicker
            workspaces={allWorkspaces}
            value={access}
            onChange={setAccess}
            disabled={add.busy}
          />
          <ErrorText error={add.error} />
          <Button type="submit" variant="primary" busy={add.busy} disabled={!email.trim()}>
            {t('common.add')}
          </Button>
        </form>
      </Card>

      {list.data && users.length === 0 && <Empty>{t('mcpUsers.none')}</Empty>}
      <ul className="space-y-2">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            workspaces={allWorkspaces}
            onChanged={replace}
            onRemove={() => setRemoving(user)}
          />
        ))}
      </ul>

      {removing && (
        <Confirm
          title={t('mcpUsers.removeTitle', { name: removing.name ?? removing.email })}
          confirmLabel={t('common.remove')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeMcpUser(removing.id);
            list.setData((d) => ({ mcpUsers: d.mcpUsers.filter((u) => u.id !== removing.id) }));
            setRemoving(null);
          }}
        >
          <p>
            {formatNodes(t('mcpUsers.removeText'), { email: <strong>{removing.email}</strong> })}
          </p>
        </Confirm>
      )}
    </div>
  );
}

import { useState } from 'react';
import { api } from '../api';
import { routePath } from '../format';
import { Badge, Button, Card, CodeReveal, Empty, ErrorText, INPUT, Link, PageTitle } from '../ui';
import { useAction, useLoad } from '../useLoad';

export function WorkspacesPage() {
  const list = useLoad(() => api.workspaces(), []);
  const create = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [revealed, setRevealed] = useState<{ code: string; workspaceName: string } | null>(null);

  async function submit() {
    const result = await create.run(() => api.createWorkspace(name.trim()));
    if (!result) return;
    list.setData((d) => ({ workspaces: [...d.workspaces, result.workspace] }));
    setRevealed({ code: result.code, workspaceName: result.workspace.name });
    setName('');
    setCreating(false);
  }

  const workspaces = list.data?.workspaces ?? [];
  return (
    <div className="space-y-4">
      <PageTitle
        loading={list.loading && list.data !== null}
        aside={
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New workspace
            </Button>
          )
        }
      >
        Workspaces
      </PageTitle>
      <ErrorText error={list.error} />

      {creating && (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) void submit();
            }}
          >
            <label className="block text-sm text-slate-300">
              Name of the new workspace
              <input
                autoFocus
                className={`${INPUT} mt-1`}
                value={name}
                maxLength={80}
                placeholder="Main hall"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="text-xs text-slate-400">
              A workspace is one congregation's library and run sheets. Its computers join it by
              pairing, or with the connection code shown once after it is created.
            </p>
            <ErrorText error={create.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" busy={create.busy} disabled={!name.trim()}>
                Create
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  create.clear();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {revealed && (
        <CodeReveal
          code={revealed.code}
          workspaceName={revealed.workspaceName}
          onClose={() => setRevealed(null)}
        />
      )}

      {list.data && workspaces.length === 0 && (
        <Empty>No workspaces yet. Create the first one to let computers join.</Empty>
      )}
      <ul className="space-y-2">
        {workspaces.map((w) => (
          <li key={w.id}>
            <Link
              to={routePath({ page: 'workspace', id: w.id })}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-slate-600"
            >
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                {w.name}
              </span>
              <span className="text-sm text-slate-400">
                {w.devices === 1 ? '1 device' : `${w.devices} devices`}
              </span>
              {w.manageLibrary && <Badge tone="accent">Manages the Church Library</Badge>}
              {w.codesEnabled && <Badge tone="warn">Connection code on</Badge>}
              {w.live && <Badge tone="live">Live</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from 'react';
import { api } from '../api';
import { libraryTypeLabel, routePath } from '../format';
import { Badge, Button, Card, CodeReveal, Empty, ErrorText, INPUT, Link, PageTitle } from '../ui';
import { useAction, useLoad } from '../useLoad';
import { t, tp } from '@worship-q/i18n/admin';

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
              {t('workspaces.new')}
            </Button>
          )
        }
      >
        {t('nav.workspaces')}
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
              {t('workspaces.nameLabel')}
              <input
                autoFocus
                className={`${INPUT} mt-1`}
                value={name}
                maxLength={80}
                placeholder={t('workspaces.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="text-xs text-slate-400">{t('workspaces.hint')}</p>
            <ErrorText error={create.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" busy={create.busy} disabled={!name.trim()}>
                {t('common.create')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  create.clear();
                }}
              >
                {t('common.cancel')}
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

      {list.data && workspaces.length === 0 && <Empty>{t('workspaces.none')}</Empty>}
      <ul className="space-y-2">
        {workspaces.map((w) => (
          <li key={w.id}>
            <Link
              to={routePath({ page: 'workspace', id: w.id })}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-slate-600"
            >
              <span className="min-w-40 flex-1 truncate text-[15px] font-semibold text-white">
                {w.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-sm text-slate-400">
                  {tp('workspaces.devices', w.devices)}
                </span>
                {w.libraryTypes.map((type) => (
                  <Badge key={type} tone="accent">
                    {libraryTypeLabel(type)}
                  </Badge>
                ))}
                {w.codesEnabled && <Badge tone="warn">{t('workspaces.codeOn')}</Badge>}
                {w.live && <Badge tone="live">{t('common.live')}</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

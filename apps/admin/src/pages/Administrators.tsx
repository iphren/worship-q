import type { AdminAdministrator } from '@worship-q/protocol';
import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Badge, Button, Card, Confirm, Empty, ErrorText, InlineForm, PageTitle, When } from '../ui';
import { useAction, useLoad } from '../useLoad';

export function AdministratorsPage() {
  const me = useSession();
  const list = useLoad(() => api.administrators(), []);
  const add = useAction();
  const [email, setEmail] = useState('');
  const [removing, setRemoving] = useState<AdminAdministrator | null>(null);

  async function submit() {
    const result = await add.run(() => api.addAdministrator(email.trim()));
    if (!result) return;
    list.setData((d) => ({ administrators: [...d.administrators, result.administrator] }));
    setEmail('');
  }

  const administrators = list.data?.administrators ?? [];
  return (
    <div className="space-y-4">
      <PageTitle loading={list.loading && list.data !== null}>Administrators</PageTitle>
      <ErrorText error={list.error} />
      <Card>
        <h2 className="mb-2 font-semibold text-white">Add an administrator</h2>
        <p className="mb-3 text-sm text-slate-400">
          Enter the e-mail address of their account with the church's sign-in provider. Having an
          account there grants nothing by itself; only addresses on this list can sign in.
        </p>
        <InlineForm
          label="E-mail address"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@church.example"
          submitLabel="Add"
          busy={add.busy}
          error={add.error}
          maxLength={200}
          onSubmit={() => void submit()}
        />
      </Card>

      {list.data && administrators.length === 0 && <Empty>No administrators.</Empty>}
      <ul className="space-y-2">
        {administrators.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-white">
                {a.name ?? a.email} {a.id === me.admin?.id && <Badge tone="accent">You</Badge>}
              </p>
              {a.name && <p className="truncate text-xs text-slate-400">{a.email}</p>}
              <p className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                <span>
                  {a.addedBy ? `Added by ${a.addedBy}` : 'Added at deployment'}{' '}
                  <When iso={a.createdAt} />
                </span>
                <span>
                  {a.lastSignInAt ? (
                    <>
                      Last signed in <When iso={a.lastSignInAt} />
                    </>
                  ) : (
                    'Never signed in'
                  )}
                </span>
              </p>
            </div>
            <Button
              small
              variant="ghost"
              disabled={administrators.length <= 1}
              title={
                administrators.length <= 1 ? 'The last administrator cannot be removed' : undefined
              }
              onClick={() => setRemoving(a)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {administrators.length <= 1 && list.data && (
        <p className="text-xs text-slate-500">
          The last administrator cannot be removed. Add another one first.
        </p>
      )}

      {removing && (
        <Confirm
          title={`Remove ${removing.name ?? removing.email}?`}
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeAdministrator(removing.id);
            list.setData((d) => ({
              administrators: d.administrators.filter((x) => x.id !== removing.id),
            }));
            setRemoving(null);
          }}
        >
          <p>
            <strong>{removing.email}</strong> can no longer sign in to these pages. Their devices
            and workspaces are not affected.
          </p>
          {removing.id === me.admin?.id && (
            <p className="text-amber-200">This is your own account: you will be signed out.</p>
          )}
        </Confirm>
      )}
    </div>
  );
}

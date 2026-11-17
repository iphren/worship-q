import type { AdminAdministrator } from '@worship-q/protocol';
import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Badge, Button, Card, Confirm, Empty, ErrorText, InlineForm, PageTitle, When } from '../ui';
import { useAction, useLoad } from '../useLoad';
import { formatNodes, t } from '@worship-q/i18n/admin';

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
      <PageTitle loading={list.loading && list.data !== null}>{t('admins.title')}</PageTitle>
      <ErrorText error={list.error} />
      <Card>
        <h2 className="mb-2 font-semibold text-white">{t('admins.addTitle')}</h2>
        <p className="mb-3 text-sm text-slate-400">{t('admins.addHint')}</p>
        <InlineForm
          label={t('admins.email')}
          type="email"
          value={email}
          onChange={setEmail}
          placeholder={t('admins.emailPlaceholder')}
          submitLabel={t('common.add')}
          busy={add.busy}
          error={add.error}
          maxLength={200}
          onSubmit={() => void submit()}
        />
      </Card>

      {list.data && administrators.length === 0 && <Empty>{t('admins.none')}</Empty>}
      <ul className="space-y-2">
        {administrators.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-white">
                {a.name ?? a.email}{' '}
                {a.id === me.admin?.id && <Badge tone="accent">{t('admins.you')}</Badge>}
              </p>
              {a.name && <p className="truncate text-xs text-slate-400">{a.email}</p>}
              <p className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                <span>
                  {a.addedBy
                    ? t('admins.addedBy', { name: a.addedBy })
                    : t('admins.addedAtDeployment')}{' '}
                  <When iso={a.createdAt} />
                </span>
                <span>
                  {a.lastSignInAt
                    ? formatNodes(t('admins.lastSignIn'), { when: <When iso={a.lastSignInAt} /> })
                    : t('admins.neverSignedIn')}
                </span>
              </p>
            </div>
            <Button
              small
              variant="ghost"
              disabled={administrators.length <= 1}
              title={administrators.length <= 1 ? t('admins.lastCannotRemoveShort') : undefined}
              onClick={() => setRemoving(a)}
            >
              {t('common.remove')}
            </Button>
          </li>
        ))}
      </ul>
      {administrators.length <= 1 && list.data && (
        <p className="text-xs text-slate-500">{t('admins.lastCannotRemove')}</p>
      )}

      {removing && (
        <Confirm
          title={t('admins.removeTitle', { name: removing.name ?? removing.email })}
          confirmLabel={t('common.remove')}
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
          <p>{formatNodes(t('admins.removeText'), { email: <strong>{removing.email}</strong> })}</p>
          {removing.id === me.admin?.id && (
            <p className="text-amber-200">{t('admins.removeSelf')}</p>
          )}
        </Confirm>
      )}
    </div>
  );
}

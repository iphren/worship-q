import { useEffect, useRef, useState } from 'react';
import { useApp, useCloud } from '../app/context';
import { deviceSettings } from '../app/deviceSettings';
import type { LiveRole } from '../app/liveLink';
import { t } from '../i18n';
import { ConfirmDialog } from './Dialog';
import { Icon, type IconName } from './Icon';

const ROLE_ICONS: Record<LiveRole, IconName> = {
  coordinator: 'live',
  follower: 'follow',
  viewer: 'viewer',
};

/**
 * This computer's part in the shared presentation while connected to the church server:
 * holding it, following another computer, or only viewing (D16). Its menu offers taking
 * over and switching viewer mode.
 */
export function LiveRoleBadge() {
  const { cloud } = useApp();
  const { live, relay } = useCloud();
  const [open, setOpen] = useState(false);
  const [viewerChange, setViewerChange] = useState<boolean | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!live || relay.kind !== 'connected') return null;
  const lost = live.coordinatorLost && live.role !== 'coordinator';
  const nobody = live.role === 'follower' && !live.coordinatorName;
  const title = lost
    ? t('live.lost')
    : live.role === 'coordinator'
      ? t('church.liveCoordinator')
      : live.role === 'viewer'
        ? t('church.liveViewer')
        : live.coordinatorName
          ? t('church.liveFollowing', { name: live.coordinatorName })
          : t('church.liveNobody');
  const color = lost
    ? 'text-amber-300 breathe'
    : live.role === 'coordinator'
      ? 'text-emerald-300'
      : live.role === 'follower' && !nobody
        ? 'text-sky-300'
        : 'text-slate-400';
  const isViewer = live.role === 'viewer';

  const choose = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    // Leave the keyboard free for the presentation shortcuts.
    event.currentTarget.blur();
    setOpen(false);
    action();
  };

  return (
    <div ref={holder} className="relative">
      <button
        className={`flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-slate-800 ${
          open ? 'bg-slate-800' : ''
        } ${color}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.blur();
          setOpen(!open);
        }}
      >
        <Icon name={ROLE_ICONS[live.role]} />
        <span className="text-[10px] leading-3 font-medium">{t(`role.${live.role}`)}</span>
      </button>
      {open && (
        <div
          className="panel absolute bottom-0 left-full z-20 ml-2 w-72 space-y-2 bg-slate-800 p-3 text-sm shadow-xl"
          role="menu"
        >
          <p className="text-slate-300">{title}</p>
          <div className="flex flex-col gap-1">
            {live.role === 'follower' && (
              <button
                className="btn btn-sm justify-start"
                role="menuitem"
                title={t(lost ? 'live.carryOnHint' : 'church.takeOverHint')}
                onClick={choose(() => cloud.takeOver())}
              >
                {lost ? t('live.carryOn') : t('church.takeOver')}
              </button>
            )}
            <button
              className="btn btn-sm justify-start"
              role="menuitem"
              onClick={choose(() => setViewerChange(!isViewer))}
            >
              {isViewer ? t('role.leaveViewer') : t('role.toViewer')}
            </button>
          </div>
        </div>
      )}
      {viewerChange !== null && (
        <ViewerModeDialog viewer={viewerChange} onCancel={() => setViewerChange(null)} />
      )}
    </div>
  );
}

/** Confirms turning viewer mode on or off; the app starts again with the new role. */
export function ViewerModeDialog(props: { viewer: boolean; onCancel(): void }) {
  return (
    <ConfirmDialog
      title={t('viewer.title')}
      body={t('viewer.hint')}
      confirmLabel={t('workspaces.leaveLiveConfirm')}
      onCancel={props.onCancel}
      onConfirm={() => {
        deviceSettings.set({ viewerMode: props.viewer });
        // The session's role is fixed when it opens, so the app starts again.
        window.location.reload();
      }}
    />
  );
}

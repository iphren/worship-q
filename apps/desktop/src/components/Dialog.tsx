import { useEffect, type ReactNode } from 'react';
import { t } from '../i18n';

export function Dialog(props: {
  title: string;
  /**
   * Drawn in place of the title, which is then only read out by screen readers. The title
   * still names the dialog.
   */
  icon?: ReactNode;
  children?: ReactNode;
  onClose(): void;
  /** Footer buttons; null hides the footer. */
  actions?: ReactNode;
  wide?: boolean;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      data-dialog
    >
      <div
        className={`flex max-h-full w-full flex-col rounded-lg border border-slate-600 bg-slate-800 shadow-2xl ${
          props.wide ? 'max-w-5xl' : 'max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <h2 className="relative flex items-center gap-2 border-b border-slate-700 px-5 py-3 text-base font-semibold">
          {props.icon ? (
            <>
              <span className="sr-only">{props.title}</span>
              {props.icon}
            </>
          ) : (
            props.title
          )}
        </h2>
        {props.children && (
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm text-slate-300">
            {props.children}
          </div>
        )}
        {props.actions !== null && (
          <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-3">
            {props.actions ?? (
              <button className="btn" onClick={onClose}>
                {t('common.close')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      title={props.title}
      onClose={props.onCancel}
      actions={
        <>
          <button className="btn" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={props.onConfirm}
            autoFocus
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      {props.body}
    </Dialog>
  );
}

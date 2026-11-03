/** The small set of controls every page is built from, in the slate theme of the remote app. */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { formatDateTime, relativeTime } from './format';
import { linkClick } from './router';
import { useAction } from './useLoad';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON: Record<Variant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
  danger: 'bg-red-700 text-white hover:bg-red-600',
  ghost: 'text-slate-300 hover:bg-slate-800',
};

export function Button(props: {
  children: ReactNode;
  variant?: Variant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  onClick?(): void;
  title?: string;
  'aria-label'?: string;
}) {
  const { variant = 'secondary', small } = props;
  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled || props.busy}
      onClick={props.onClick}
      title={props.title}
      aria-label={props['aria-label']}
      aria-busy={props.busy}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-[15px]'
      } ${BUTTON[variant]}`}
    >
      {props.busy && <Spinner />}
      {props.children}
    </button>
  );
}

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const INPUT =
  'w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:opacity-50';

export function Link(props: { to: string; children: ReactNode; className?: string }) {
  return (
    <a href={props.to} onClick={linkClick} className={props.className}>
      {props.children}
    </a>
  );
}

/** A failure in plain words, placed next to the control that failed. */
export function ErrorText({ error, className = '' }: { error: string | null; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={`text-sm text-red-300 ${className}`}>
      {error}
    </p>
  );
}

export function Notice(props: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning';
  onClose?(): void;
}) {
  const tone = {
    info: 'border-sky-800 bg-sky-950/60 text-sky-100',
    success: 'border-emerald-800 bg-emerald-950/60 text-emerald-100',
    warning: 'border-amber-700 bg-amber-950/60 text-amber-100',
  }[props.tone ?? 'info'];
  return (
    <div role="status" className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <div className="min-w-0 flex-1 space-y-1">{props.children}</div>
      {props.onClose && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={props.onClose}
          className="shrink-0 self-start text-lg leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Badge(props: { children: ReactNode; tone?: 'live' | 'muted' | 'accent' | 'warn' }) {
  const tone = {
    live: 'bg-emerald-800 text-emerald-100',
    muted: 'bg-slate-700 text-slate-200',
    accent: 'bg-violet-900 text-violet-100',
    warn: 'bg-amber-800 text-amber-100',
  }[props.tone ?? 'muted'];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {props.children}
    </span>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 ${props.className ?? ''}`}
    >
      {props.children}
    </section>
  );
}

export function SectionTitle(props: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-white">{props.children}</h2>
      {props.aside}
    </div>
  );
}

export function PageTitle(props: { children: ReactNode; aside?: ReactNode; loading?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-3 text-2xl font-semibold text-white">
        {props.children}
        {props.loading && (
          <span className="text-slate-500" aria-label="Refreshing">
            <Spinner />
          </span>
        )}
      </h1>
      {props.aside}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-400">{children}</p>;
}

/** A moment in words, with the exact time on hover. */
export function When({ iso, prefix }: { iso: string; prefix?: string }) {
  // Re-rendered every minute so "just now" ages.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {prefix ? `${prefix} ` : ''}
      {relativeTime(iso)}
    </time>
  );
}

export function Switch(props: {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-40 ${
        props.checked ? 'bg-sky-600' : 'bg-slate-700'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          props.checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/**
 * A question before an action, in a dialog. `onConfirm` runs the action; its failure is
 * shown inside the dialog, which stays open so the person can try again or give up.
 */
export function Confirm(props: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The confirm button waits for this, for a dialog that first loads what it shows. */
  ready?: boolean;
  onConfirm(): Promise<void>;
  onCancel(): void;
}) {
  const action = useAction();
  const titleId = useId();
  const { onCancel } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold text-white">
          {props.title}
        </h2>
        <div className="space-y-3 text-sm text-slate-300">{props.children}</div>
        <ErrorText error={action.error} className="mt-3" />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            busy={action.busy}
            disabled={props.ready === false}
            onClick={() => void action.run(props.onConfirm)}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A one-line form: a text field and a button, with the failure shown under it. */
export function InlineForm(props: {
  value: string;
  onChange(value: string): void;
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  error: string | null;
  onSubmit(): void;
  onCancel?(): void;
  type?: 'text' | 'email';
  maxLength?: number;
  autoFocus?: boolean;
  label: string;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (props.value.trim()) props.onSubmit();
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={INPUT}
          type={props.type ?? 'text'}
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.label}
          maxLength={props.maxLength ?? 80}
          autoFocus={props.autoFocus}
          disabled={props.busy}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') props.onCancel?.();
          }}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={props.busy} disabled={!props.value.trim()}>
            {props.submitLabel}
          </Button>
          {props.onCancel && (
            <Button variant="ghost" onClick={props.onCancel} disabled={props.busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      <ErrorText error={props.error} />
    </form>
  );
}

/** A connection code, shown once, large enough to read out (D30). */
export function CodeReveal(props: { code: string; workspaceName: string; onClose(): void }) {
  return (
    <Notice tone="success" onClose={props.onClose}>
      <p>
        Connection code for <strong>{props.workspaceName}</strong>. It is shown only once; write it
        down now.
      </p>
      <p className="my-2 font-mono text-3xl tracking-[0.2em] text-white select-all">{props.code}</p>
      <p>
        Codes only work while <strong>Connection code</strong> is turned on for the workspace. New
        computers normally pair instead, and an administrator approves them on the Devices page.
      </p>
    </Notice>
  );
}

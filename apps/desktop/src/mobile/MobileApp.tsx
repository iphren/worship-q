import { t } from '@worship-q/i18n/desktop';

/**
 * The phone and tablet app's home: the device's workspaces (native apps plan, "The workspace
 * list"). The page draws under the status bar and home indicator and pads by their insets.
 */
export function MobileApp() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-slate-100">
      <header className="px-4 pt-4 pb-2">
        <h1 className="text-2xl font-semibold">{t('mobile.workspaces')}</h1>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6 px-6 text-center">
        <p className="text-slate-300">{t('mobile.empty')}</p>
      </main>
      <footer className="p-4">
        <button className="btn btn-primary min-h-12 w-full text-base" disabled>
          {t('mobile.scan')}
        </button>
      </footer>
    </div>
  );
}

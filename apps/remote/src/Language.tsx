/**
 * The phone's Language switch (translation plan T2): a globe in the header that opens a
 * sheet of the languages, kept in this phone's browser.
 */
import {
  languageChoices,
  loadBrowserPreference,
  saveBrowserPreference,
  t,
} from '@worship-q/i18n/remote';
import { useState } from 'react';

export function LanguageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-200 active:scale-95"
        title={t('language.label')}
        aria-label={t('language.label')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
      </button>
      {open && <LanguageSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function LanguageSheet(props: { onClose(): void }) {
  const current = loadBrowserPreference();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 land:items-center"
      onClick={props.onClose}
    >
      <div
        role="dialog"
        aria-label={t('language.label')}
        className="w-full max-w-sm rounded-t-2xl bg-slate-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] land:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-1 font-semibold text-white">{t('language.label')}</h2>
        <p className="mb-3 text-xs text-slate-400">{t('language.autoHint')}</p>
        <ul className="space-y-1.5">
          {languageChoices().map((choice) => (
            <li key={choice.value}>
              <button
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                  choice.value === current
                    ? 'border-sky-500 bg-sky-900/40 text-white'
                    : 'border-slate-700 bg-slate-800'
                }`}
                aria-pressed={choice.value === current}
                onClick={() => {
                  saveBrowserPreference(choice.value);
                  props.onClose();
                }}
              >
                {choice.label}
                {choice.value === current && <span aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

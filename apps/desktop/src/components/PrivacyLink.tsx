import { invoke } from '@tauri-apps/api/core';
import { getLocale, t } from '@worship-q/i18n/desktop';

/**
 * Opens the website's privacy notice in the interface language (public server M7.5). It sits
 * at the end of each note on what the public server does.
 */
export function PrivacyLink() {
  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-slate-200"
      onClick={() =>
        void invoke('open_privacy', { locale: getLocale() }).catch((error: unknown) =>
          console.error(error),
        )
      }
    >
      {t('public.privacy')}
    </button>
  );
}
